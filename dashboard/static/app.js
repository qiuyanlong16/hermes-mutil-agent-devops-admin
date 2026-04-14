let currentAgent = null;
let currentLogType = "gateway.log";
let eventSource = null;

function selectAgent(name) {
    // Remove highlight from all cards
    document.querySelectorAll('.agent-card').forEach(card => {
        card.classList.remove('border-blue-500', 'ring-1', 'ring-blue-500');
    });

    // Highlight selected card
    event.currentTarget.classList.add('border-blue-500', 'ring-1', 'ring-blue-500');

    // Show log controls
    document.getElementById('log-controls').classList.remove('hidden');
    document.getElementById('log-controls').classList.add('flex');
    document.getElementById('log-agent-name').textContent = name;

    // Switch SSE stream
    currentAgent = name;
    startLogStream();
}

function selectLogTab(logType) {
    currentLogType = logType;

    // Update tab styles
    document.querySelectorAll('.log-tab').forEach(tab => {
        if (tab.dataset.logType === logType) {
            tab.classList.remove('bg-gray-800', 'text-gray-400');
            tab.classList.add('bg-blue-600', 'text-white');
        } else {
            tab.classList.remove('bg-blue-600', 'text-white');
            tab.classList.add('bg-gray-800', 'text-gray-400');
        }
    });

    // Restart SSE with new log type
    startLogStream();
}

function startLogStream() {
    if (!currentAgent) return;

    // Close existing connection
    if (eventSource) {
        eventSource.close();
    }

    // Clear log output
    const output = document.getElementById('log-output');
    output.innerHTML = '';

    // Load recent lines first
    fetch(`/api/logs/${currentAgent}/recent?log_type=${currentLogType}`)
        .then(r => r.json())
        .then(data => {
            if (data.lines) {
                output.innerHTML = formatLogLines(data.lines);
                output.scrollTop = output.scrollHeight;
            }
        })
        .catch(() => {});

    // Open SSE connection
    eventSource = new EventSource(
        `/api/logs/${currentAgent}/stream?log_type=${currentLogType}`
    );

    eventSource.addEventListener('log', (e) => {
        const output = document.getElementById('log-output');
        const div = document.createElement('div');
        div.className = 'log-line whitespace-pre';
        div.textContent = e.data;
        output.appendChild(div);

        // Auto-scroll if near bottom
        if (output.scrollHeight - output.scrollTop - output.clientHeight < 100) {
            output.scrollTop = output.scrollHeight;
        }

        // Limit displayed lines to prevent memory issues
        while (output.children.length > 2000) {
            output.removeChild(output.firstChild);
        }
    });

    eventSource.addEventListener('error', (e) => {
        const output = document.getElementById('log-output');
        const div = document.createElement('div');
        div.className = 'text-red-400';
        div.textContent = e.data;
        output.appendChild(div);
    });
}

function clearLogs() {
    document.getElementById('log-output').innerHTML = '';
}

function formatLogLines(text) {
    return text.split('\n').map(line => {
        return `<div class="log-line whitespace-pre">${escapeHtml(line)}</div>`;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function refreshAgentList() {
    // Trigger HTMX to refresh agent list immediately
    const agentList = document.getElementById('agent-list');
    if (agentList) {
        htmx.trigger(agentList, 'htmx:poll');
    }
}

// Re-select agent card after HTMX swap (polling replaces innerHTML)
document.body.addEventListener('htmx:afterSwap', function(evt) {
    if (evt.detail.target.id === 'agent-list' && currentAgent) {
        // Re-highlight the currently selected card
        const cards = document.querySelectorAll('.agent-card');
        cards.forEach(card => {
            const onclick = card.getAttribute('onclick');
            if (onclick && onclick.includes(`'${currentAgent}'`)) {
                card.classList.add('border-blue-500', 'ring-1', 'ring-blue-500');
            }
        });
    }
});
