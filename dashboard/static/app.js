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
            refreshAgentList();
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
    // tabId is like "log-gateway.log" or "detail-scheduler-pusher-cron"
    const parts = tabId.split('-');
    if (parts[0] === 'log') {
        const logType = parts.slice(1).join('-');
        activateLogTab(logType);
    } else if (parts[0] === 'detail') {
        const agent = parts[1];
        const type = parts[2];
        activateDetailTab(agent, type);
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
        .then(r => r.json())
        .then(data => {
            if (type === 'cron') {
                output.innerHTML = renderCronList(data.jobs, agent);
            } else if (type === 'sessions') {
                output.innerHTML = renderSessionList(data.sessions, agent);
            } else if (type === 'skills') {
                output.innerHTML = renderSkillsList(data.skills, agent);
            }
        })
        .catch(() => {
            output.innerHTML = '<div class="detail-error">Failed to load data</div>';
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
        const stateLabel = job.state || '';
        const nextRun = job.next_run ? ` · next: ${job.next_run.split('T')[1]?.substring(0, 5) || job.next_run}` : '';
        html += `<div class="detail-item${enabledClass}">
            <span class="detail-item-name">${escapeHtml(job.name)}</span>
            <span class="detail-item-meta">${escapeHtml(job.schedule)}${nextRun}</span>
            <span class="detail-item-state">${stateLabel}</span>
        </div>`;
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
    let html = `<div class="detail-header">${agent} — Skills (${skills.length})</div>`;
    html += '<div class="detail-list">';
    for (const name of skills) {
        html += `<div class="detail-item">
            <span class="detail-item-name">${escapeHtml(name)}</span>
        </div>`;
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
