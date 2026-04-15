let currentAgent = null;
let currentLogType = "gateway.log";
let eventSource = null;
let pollTimer = null;
let activeDetailTabs = []; // { id, agent, type, label }

/* ============================================================
   Agent Actions — vanilla fetch (replaces HTMX hx-post)
   ============================================================ */

async function agentAction(name, action, btnEl) {
    const originalText = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.innerHTML = '<span class="spinner"></span>';

    try {
        const resp = await fetch(`/api/agents/${name}/${action}`, {
            method: 'POST',
        });
        if (resp.ok) {
            // Actions that don't change agent state don't need a full list refresh
            const noRefreshActions = ['open-terminal', 'open-db'];
            if (noRefreshActions.includes(action)) {
                // Brief visual feedback: show checkmark then restore
                btnEl.innerHTML = '&#10003;';
                await new Promise(r => setTimeout(r, 800));
                btnEl.textContent = originalText;
                btnEl.disabled = false;
            } else {
                refreshAgentList();
            }
        } else {
            btnEl.disabled = false;
            btnEl.textContent = originalText;
            const data = await resp.json().catch(() => ({}));
            console.error(`Action ${action} failed for ${name}:`, data);
        }
    } catch (err) {
        btnEl.disabled = false;
        btnEl.textContent = originalText;
        console.error(`Action ${action} failed for ${name}:`, err);
    }
}

/* ============================================================
   Agent Selection
   ============================================================ */

function selectAgent(name, evt) {
    document.querySelectorAll('.agent-card').forEach(card => {
        card.classList.remove('selected');
    });

    evt.currentTarget.classList.add('selected');

    const logControls = document.getElementById('log-controls');
    logControls.classList.remove('hidden');
    document.getElementById('log-agent-name').textContent = name;

    currentAgent = name;
    startLogStream();
}

/* ============================================================
   Tab Management
   ============================================================ */

function switchTab(tabId) {
    if (tabId.startsWith('log-')) {
        const logType = tabId.slice(4);
        activateLogTab(logType);
    } else if (tabId.startsWith('detail-')) {
        // Look up in tracked tabs — can't split by '-' because agent names contain hyphens
        const tab = activeDetailTabs.find(t => t.id === tabId);
        if (tab) {
            activateDetailTab(tab.agent, tab.type);
        }
    }
}

function activateLogTab(logType) {
    currentLogType = logType;

    // Update tab styles
    document.querySelectorAll('.log-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tabId === `log-${logType}`);
    });

    // Show log output, hide detail output
    document.getElementById('log-output').classList.remove('hidden');
    document.getElementById('detail-output').classList.add('hidden');

    startLogStream();
}

function activateDetailTab(agent, type) {
    // Update tab styles
    document.querySelectorAll('.log-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tabId === `detail-${agent}-${type}`);
    });

    // Show detail output, hide log output
    document.getElementById('detail-output').classList.remove('hidden');
    document.getElementById('log-output').classList.add('hidden');

    // Close SSE if open
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    // Fetch and render detail content
    renderDetailContent(agent, type);
}

/* ============================================================
   Detail Tab: Open / Close / Render
   ============================================================ */

function openDetailTab(agent, type, evt) {
    evt.stopPropagation();

    const tabId = `detail-${agent}-${type}`;

    // Check if tab already exists
    if (activeDetailTabs.find(t => t.id === tabId)) {
        switchTab(tabId);
        return;
    }

    const labels = { cron: 'cron', sessions: 'sessions', skills: 'skills' };
    const label = labels[type] || type;

    // Add tab button
    const tabsContainer = document.getElementById('log-tabs');
    const btn = document.createElement('button');
    btn.className = 'log-tab active';
    btn.dataset.tabId = tabId;
    btn.innerHTML = `${label} <span class="tab-close" onclick="closeDetailTab('${agent}', '${type}', event)">&times;</span>`;
    btn.onclick = () => switchTab(tabId);
    tabsContainer.appendChild(btn);

    // Track tab
    activeDetailTabs.push({ id: tabId, agent, type });

    // Activate this tab
    switchTab(tabId);
}

function closeDetailTab(agent, type, evt) {
    evt.stopPropagation();
    const tabId = `detail-${agent}-${type}`;

    // Remove tab button
    const tabBtn = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabBtn) tabBtn.remove();

    // Remove from tracking
    activeDetailTabs = activeDetailTabs.filter(t => t.id !== tabId);

    // If this was the active tab, switch to gateway.log
    if (tabBtn && tabBtn.classList.contains('active')) {
        activateLogTab('gateway.log');
    }
}

function renderDetailContent(agent, type) {
    const output = document.getElementById('detail-output');
    output.innerHTML = '<div class="detail-loading">Loading...</div>';

    fetch(`/api/agents/${agent}/${type}`)
        .then(r => {
            if (!r.ok) {
                throw new Error(`HTTP ${r.status}`);
            }
            return r.json();
        })
        .then(data => {
            if (type === 'cron') {
                output.innerHTML = renderCronList(data.jobs, agent);
            } else if (type === 'sessions') {
                output.innerHTML = renderSessionList(data.sessions, agent);
            } else if (type === 'skills') {
                output.innerHTML = renderSkillsList(data.skills, agent);
            }
        })
        .catch((err) => {
            output.innerHTML = `<div class="detail-error">Failed to load ${type}: ${err.message}</div>`;
        });
}

function renderCronList(jobs, agent) {
    if (!jobs || jobs.length === 0) {
        return '<div class="detail-empty">No cron jobs configured</div>';
    }
    let html = `<div class="detail-header">${agent} — Cron Jobs (${jobs.length})</div>`;
    html += '<div class="detail-list">';
    for (const job of jobs) {
        const enabledClass = job.enabled ? '' : ' disabled';
        // Format time: extract HH:MM from ISO string
        const fmtTime = (iso) => iso ? iso.split('T')[1]?.substring(0, 5) || iso : '—';
        const fmtDate = (iso) => iso ? iso.split('T')[0] : '—';

        html += `<div class="detail-item${enabledClass}">`;
        html += `<div style="display:flex;flex-direction:column;gap:6px;flex:1;min-width:0">`;
        // Row 1: name + state badge
        html += `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">`;
        html += `<span class="detail-item-name" title="${escapeHtml(job.id)}">${escapeHtml(job.name)}</span>`;
        html += `<span class="detail-item-state">${job.state || '—'}</span>`;
        html += `</div>`;
        // Row 2: schedule
        html += `<div style="display:flex;gap:16px;flex-wrap:wrap">`;
        html += `<span class="detail-item-meta">Schedule: <code>${escapeHtml(job.schedule || '—')}</code></span>`;
        // Row 3: timing info
        html += `<span class="detail-item-meta">Next: ${fmtDate(job.next_run)} ${fmtTime(job.next_run)}</span>`;
        if (job.last_run) {
            html += `<span class="detail-item-meta">Last: ${fmtDate(job.last_run)} ${fmtTime(job.last_run)} ${job.last_status ? `(${job.last_status})` : ''}</span>`;
        }
        // Row 4: model + repeat info
        const metaParts = [];
        if (job.model) metaParts.push(job.model);
        if (job.repeat_times !== null) metaParts.push(`repeat: ${job.repeat_completed}/${job.repeat_times}`);
        if (metaParts.length > 0) {
            html += `<span class="detail-item-meta">${metaParts.join(' · ')}</span>`;
        }
        if (job.last_error) {
            html += `<span style="color:#f87171;font-size:10px" title="${escapeHtml(job.last_error)}">Error: ${escapeHtml(job.last_error.substring(0, 80))}</span>`;
        }
        html += `</div>`;
        html += `</div></div>`;
    }
    html += '</div>';
    return html;
}

function renderSessionList(sessions, agent) {
    if (!sessions || sessions.length === 0) {
        return '<div class="detail-empty">No sessions found</div>';
    }
    let html = `<div class="detail-header">${agent} — Sessions (${sessions.length})</div>`;
    html += '<div class="detail-list">';
    for (const s of sessions) {
        const msgLabel = s.message_count > 0 ? `${s.message_count} msgs` : '';
        html += `<div class="detail-item">
            <span class="detail-item-name">${escapeHtml(s.title || s.id)}</span>
            <span class="detail-item-meta">${escapeHtml(s.created)}</span>
            <span class="detail-item-state">${msgLabel}</span>
        </div>`;
    }
    html += '</div>';
    return html;
}

function renderSkillsList(skills, agent) {
    if (!skills || skills.length === 0) {
        return '<div class="detail-empty">No skills found</div>';
    }

    // Group by category
    const categories = {};
    for (const skill of skills) {
        const cat = skill.category || 'other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(skill);
    }

    // Category display labels
    const catLabels = {
        'social-media': 'Social Media',
        'github': 'GitHub',
        'google': 'Google',
        'productivity': 'Productivity',
        'research': 'Research',
        'creative': 'Creative',
        'data-science': 'Data Science',
        'software-development': 'Software Development',
        'autonomous-ai-agents': 'Autonomous AI',
        'mlops': 'MLOps',
        'devops': 'DevOps',
        'diagramming': 'Diagramming',
    };

    let html = `<div class="detail-header">${agent} — Skills (${skills.length})</div>`;
    html += '<div class="skills-container">';

    for (const [cat, catSkills] of Object.entries(categories).sort()) {
        const label = catLabels[cat] || cat;
        html += `<div class="skills-category">`;
        html += `<div class="skills-category-title">${escapeHtml(label)} (${catSkills.length})</div>`;
        html += '<div class="skills-grid">';

        for (const skill of catSkills) {
            html += `<div class="skill-card" data-category="${escapeHtml(skill.category)}">`;
            // Skill header
            html += `<div class="skill-card-header">`;
            html += `<span class="skill-card-name">${escapeHtml(skill.name)}</span>`;
            html += `<span class="skill-badge ${skill.is_bundled ? 'skill-badge-builtin' : 'skill-badge-installed'}">${skill.is_bundled ? 'Builtin' : 'Installed'}</span>`;
            if (skill.version) {
                html += `<span class="skill-card-version">${escapeHtml(skill.version)}</span>`;
            }
            html += `</div>`;
            // Description
            if (skill.description) {
                html += `<div class="skill-card-desc">${escapeHtml(skill.description)}</div>`;
            }
            // Tags
            if (skill.tags && skill.tags.length > 0) {
                html += '<div class="skill-card-tags">';
                for (const tag of skill.tags.slice(0, 5)) {
                    html += `<span class="skill-tag">${escapeHtml(tag)}</span>`;
                }
                html += '</div>';
            }
            // Footer: author
            if (skill.author) {
                html += `<div class="skill-card-footer">`;
                html += `<span class="skill-card-author">by ${escapeHtml(skill.author)}</span>`;
                html += `</div>`;
            }
            html += '</div>';
        }

        html += '</div></div>';
    }

    html += '</div>';
    return html;
}

/* ============================================================
   SSE Log Streaming
   ============================================================ */

function startLogStream() {
    if (!currentAgent) return;

    if (eventSource) {
        eventSource.close();
    }

    const output = document.getElementById('log-output');
    output.innerHTML = '';

    // Load recent lines
    fetch(`/api/logs/${currentAgent}/recent?log_type=${currentLogType}`)
        .then(r => r.json())
        .then(data => {
            if (data.lines) {
                output.innerHTML = formatLogLines(data.lines);
                output.scrollTop = output.scrollHeight;
            }
        })
        .catch(() => {});

    // SSE
    eventSource = new EventSource(
        `/api/logs/${currentAgent}/stream?log_type=${currentLogType}`
    );

    eventSource.addEventListener('log', (e) => {
        const output = document.getElementById('log-output');
        const div = document.createElement('div');
        div.className = 'log-line';
        div.textContent = e.data;
        output.appendChild(div);

        if (output.scrollHeight - output.scrollTop - output.clientHeight < 100) {
            output.scrollTop = output.scrollHeight;
        }

        while (output.children.length > 2000) {
            output.removeChild(output.firstChild);
        }
    });

    eventSource.addEventListener('error', (e) => {
        const output = document.getElementById('log-output');
        const div = document.createElement('div');
        div.style.color = '#f87171';
        div.textContent = e.data;
        output.appendChild(div);
    });
}

function clearLogs() {
    document.getElementById('log-output').innerHTML = '';
}

function formatLogLines(text) {
    return text.split('\n').map(line => {
        return `<div class="log-line">${escapeHtml(line)}</div>`;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/* ============================================================
   Agent List Polling
   ============================================================ */

async function refreshAgentList() {
    try {
        const resp = await fetch('/api/agents');
        const html = await resp.text();
        const agentList = document.getElementById('agent-list');
        if (agentList) {
            agentList.innerHTML = html;

            // Re-highlight selected agent
            if (currentAgent) {
                const cards = agentList.querySelectorAll('.agent-card');
                cards.forEach(card => {
                    const onclick = card.getAttribute('onclick');
                    if (onclick && onclick.includes(`'${currentAgent}'`)) {
                        card.classList.add('selected');
                    }
                });
            }
        }
    } catch (err) {
        console.error('Failed to refresh agent list:', err);
    }
}

function startPolling() {
    pollTimer = setInterval(refreshAgentList, 5000);
}

// Boot
startPolling();
