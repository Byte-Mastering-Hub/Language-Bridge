// ==================== CHAT MODULE ====================

// Socket connection (safe fallback if server not running)
const socket = (typeof io !== 'undefined') ? io('http://localhost:5000') : {
    connected: false,
    emit: () => {},
    on: () => {}
};
let currentUser = null;
let currentChat = 'maria';

// Load user data
document.addEventListener('DOMContentLoaded', () => {
    // Get user from localStorage
    const userData = localStorage.getItem('currentUser');
    if (userData) {
        currentUser = JSON.parse(userData);
        updateUserUI();
    } else {
        // Redirect to login if no user
        window.location.href = 'index.html';
    }
    
    loadSampleMessages();
    setupEventListeners();
    setupSocketListeners();
});

function updateUserUI() {
    if (currentUser) {
        document.getElementById('header-username').textContent = currentUser.username;
        document.getElementById('header-avatar').textContent = 
            currentUser.username.substring(0, 2).toUpperCase();
    }
}

function setupEventListeners() {
    // Send message
    document.getElementById('send-message-btn')?.addEventListener('click', sendMessage);
    document.getElementById('message-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    
    // Contact selection
    document.querySelectorAll('.contact-item').forEach(contact => {
        contact.addEventListener('click', (e) => {
            selectContact(e.currentTarget);
        });
    });
    
    // Search contacts
    document.getElementById('search-contacts')?.addEventListener('input', (e) => {
        searchContacts(e.target.value);
    });
}

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('🚀 Connected to server');
        if (currentUser) {
            socket.emit('user-online', currentUser.id);
        }
    });
    
    socket.on('new-message', (message) => {
        receiveMessage(message);
        window.showToast(`📩 New message from ${message.sender}`, 'info');
    });
    
    socket.on('user-typing', (data) => {
        // Show typing indicator
        console.log('User typing:', data);
    });
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;
    
    // Add message to UI
    addMessageToUI(text, 'sent');
    input.value = '';
    
    // Emit to server
    if (socket.connected) {
        socket.emit('send-message', {
            chatId: currentChat,
            text: text,
            sender: currentUser?.username,
            timestamp: new Date().toISOString()
        });
    }
    
    // Simulate reply after 2 seconds (demo)
    setTimeout(simulateReply, 2000);
}

function addMessageToUI(text, type, sender = 'Maria Kim', translation = null) {
    const messagesList = document.getElementById('messages-list');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    let translationHtml = '';
    if (translation) {
        translationHtml = `
            <div class="message-translation">
                <i class="fas fa-language"></i>
                ${translation}
            </div>
        `;
    }
    
    let senderInfo = '';
    if (type === 'received') {
        senderInfo = `
            <div class="message-header">
                <div class="msg-avatar-small">${sender.substring(0, 2).toUpperCase()}</div>
                <span class="msg-sender">${sender}</span>
            </div>
        `;
    }
    
    messageDiv.innerHTML = `
        ${senderInfo}
        <div class="message-bubble">
            <div class="message-text">${text}</div>
            ${translationHtml}
            <span class="message-time">Just now</span>
        </div>
    `;
    
    messagesList.appendChild(messageDiv);
    messagesList.scrollTop = messagesList.scrollHeight;
}

function receiveMessage(message) {
    addMessageToUI(message.text, 'received', message.sender, message.translation);
}

function simulateReply() {
    const replies = [
        { text: "That's great! 😊", translation: "それは素晴らしいです！" },
        { text: "I totally agree with you!", translation: "完全に同意します！" },
        { text: "Thanks for sharing that!", translation: "共有してくれてありがとう！" },
        { text: "Interesting point of view!", translation: "面白い視点ですね！" }
    ];
    
    const randomReply = replies[Math.floor(Math.random() * replies.length)];
    addMessageToUI(randomReply.text, 'received', 'Maria Kim', randomReply.translation);
    window.showToast('📩 New message from Maria', 'info');
}

function selectContact(contactElement) {
    // Update active state
    document.querySelectorAll('.contact-item').forEach(el => {
        el.classList.remove('active');
    });
    contactElement.classList.add('active');
    
    // Update current chat
    currentChat = contactElement.dataset.contact;
    
    // Update profile
    const contactName = contactElement.querySelector('.contact-name').textContent;
    document.getElementById('profile-name').textContent = contactName;
    document.getElementById('profile-avatar').textContent = 
        contactName.substring(0, 2).toUpperCase();
    
    window.showToast(`💬 Chat with ${contactName}`, 'info');
}

function searchContacts(query) {
    const contacts = document.querySelectorAll('.contact-item');
    const searchTerm = query.toLowerCase();
    
    contacts.forEach(contact => {
        const name = contact.querySelector('.contact-name').textContent.toLowerCase();
        const preview = contact.querySelector('.contact-preview').textContent.toLowerCase();
        
        if (name.includes(searchTerm) || preview.includes(searchTerm)) {
            contact.style.display = 'flex';
        } else {
            contact.style.display = 'none';
        }
    });
}

function logout() {
    if (socket.connected) {
        socket.emit('user-offline', currentUser?.id);
    }
    localStorage.removeItem('currentUser');
    window.showToast('👋 Logged out successfully', 'info');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1500);
}

function loadSampleMessages() {
    const messagesList = document.getElementById('messages-list');
    messagesList.innerHTML = '';
    
    // Sample messages
    const sampleMessages = [
        { type: 'received', sender: 'Maria Kim', text: 'Hello! How are you today?', translation: 'こんにちは！今日はどうですか？', time: '10:30 AM' },
        { type: 'sent', text: "I'm doing great, thanks for asking! How about you?", translation: '元気です、聞いてくれてありがとう！あなたは？', time: '10:32 AM' },
        { type: 'received', sender: 'Maria Kim', text: 'Check out this view from my office!', translation: null, time: '10:35 AM', image: true },
        { type: 'sent', text: 'Voice message', translation: '音声メッセージ', time: '10:40 AM', voice: true },
        { type: 'received', sender: 'Maria Kim', text: "Here's the document you requested", translation: null, time: '11:00 AM', file: true }
    ];
    
    sampleMessages.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${msg.type}`;
        
        let content = '';
        
        if (msg.image) {
            content = `
                <div class="image-container">
                    <img src="https://images.unsplash.com/photo-1497366754035-f200968a6e72?w=300" alt="Office view">
                    <div class="image-overlay">
                        <i class="fas fa-download"></i>
                    </div>
                </div>
            `;
        } else if (msg.voice) {
            content = `
                <div class="voice-container">
                    <button class="voice-play">
                        <i class="fas fa-play"></i>
                    </button>
                    <div class="wave-group">
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                        <div class="wave-bar"></div>
                    </div>
                    <span class="voice-duration">0:24</span>
                </div>
            `;
        } else if (msg.file) {
            content = `
                <div class="file-container">
                    <i class="fas fa-file-pdf file-icon"></i>
                    <div class="file-details">
                        <div class="file-name">Project_Proposal.pdf</div>
                        <div class="file-meta">2.4 MB</div>
                    </div>
                    <i class="fas fa-download file-download"></i>
                </div>
            `;
        } else {
            content = `<div class="message-text">${msg.text}</div>`;
        }
        
        let translationHtml = '';
        if (msg.translation && !msg.image && !msg.voice && !msg.file) {
            translationHtml = `
                <div class="message-translation">
                    <i class="fas fa-language"></i>
                    ${msg.translation}
                </div>
            `;
        } else if (msg.voice && msg.translation) {
            translationHtml = `
                <div class="message-translation">
                    <i class="fas fa-language"></i>
                    ${msg.translation}
                </div>
            `;
        }
        
        let senderInfo = '';
        if (msg.type === 'received') {
            senderInfo = `
                <div class="message-header">
                    <div class="msg-avatar-small">${msg.sender.substring(0, 2).toUpperCase()}</div>
                    <span class="msg-sender">${msg.sender}</span>
                </div>
            `;
        }
        
        messageDiv.innerHTML = `
            ${senderInfo}
            <div class="message-bubble">
                ${content}
                ${translationHtml}
                <span class="message-time">${msg.time}</span>
            </div>
        `;
        
        messagesList.appendChild(messageDiv);
    });

    messagesList.scrollTop = messagesList.scrollHeight;
}

// ===== OPTIONS MENU =====
document.addEventListener('DOMContentLoaded', () => {
    const optionsBtn = document.getElementById('options-btn');
    const dropdown = document.getElementById('options-dropdown');

    // Toggle dropdown
    optionsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    document.addEventListener('click', () => {
        dropdown?.classList.remove('open');
    });

    // --- My Profile ---
    document.getElementById('opt-profile')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        const user = currentUser || { username: 'Guest', language: 'en' };
        const langNames = { en:'English', ja:'Japanese', ko:'Korean', es:'Spanish', fr:'French', de:'German', hi:'Hindi', ar:'Arabic' };
        document.getElementById('modal-avatar').textContent = user.username.substring(0, 2).toUpperCase();
        document.getElementById('modal-username').textContent = user.username;
        document.getElementById('modal-language').textContent = langNames[user.language] || user.language;
        document.getElementById('profile-modal').classList.add('open');
    });

    // --- Clear Chat ---
    document.getElementById('opt-clear-chat')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        document.getElementById('clear-modal').classList.add('open');
    });

    document.getElementById('confirm-clear')?.addEventListener('click', () => {
        document.getElementById('messages-list').innerHTML = '';
        document.getElementById('clear-modal').classList.remove('open');
        window.showToast('🗑️ Chat cleared', 'success');
    });

    // --- Export Chat ---
    document.getElementById('opt-export')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        const messages = document.querySelectorAll('#messages-list .message');
        if (!messages.length) {
            window.showToast('No messages to export', 'warning');
            return;
        }
        let text = `LinguaBridge Chat Export\n${new Date().toLocaleString()}\n${'─'.repeat(40)}\n\n`;
        messages.forEach(msg => {
            const isSent = msg.classList.contains('sent');
            const sender = isSent ? (currentUser?.username || 'You') : (msg.querySelector('.msg-sender')?.textContent || 'Contact');
            const content = msg.querySelector('.message-text')?.textContent || msg.querySelector('.voice-duration') ? '[Voice message]' : '[File]';
            const time = msg.querySelector('.message-time')?.textContent || '';
            text += `[${time}] ${sender}: ${content}\n`;
        });
        const blob = new Blob([text], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chat-export-${Date.now()}.txt`;
        a.click();
        window.showToast('📥 Chat exported', 'success');
    });

    // --- Mute Notifications ---
    let muted = localStorage.getItem('muted') === 'true';
    function updateMuteUI() {
        document.getElementById('mute-icon').className = muted ? 'fas fa-bell-slash' : 'fas fa-bell';
        document.getElementById('mute-label').textContent = muted ? 'Unmute Notifications' : 'Mute Notifications';
    }
    updateMuteUI();

    document.getElementById('opt-mute')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        muted = !muted;
        localStorage.setItem('muted', muted);
        updateMuteUI();
        window.showToast(muted ? '🔕 Notifications muted' : '🔔 Notifications unmuted', 'info');
    });

    // --- Light / Dark Mode ---
    const lightMode = localStorage.getItem('lightMode') === 'true';
    if (lightMode) document.body.classList.add('light-mode');

    document.getElementById('opt-appearance')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        const isLight = document.body.classList.toggle('light-mode');
        localStorage.setItem('lightMode', isLight);
        document.getElementById('opt-appearance').querySelector('span').textContent = isLight ? 'Dark Mode' : 'Light Mode';
        window.showToast(isLight ? '☀️ Light mode on' : '🌙 Dark mode on', 'info');
    });

    // --- Help ---
    document.getElementById('opt-help')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        document.getElementById('help-modal').classList.add('open');
    });

    // --- Logout ---
    document.getElementById('opt-logout')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        logout();
    });

    // --- Close all modals ---
    document.querySelectorAll('.modal-close, [data-close]').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.close || el.closest('.modal-overlay')?.id;
            document.getElementById(id)?.classList.remove('open');
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });
});

// ===== ADD CONTACT =====
document.addEventListener('DOMContentLoaded', () => {
    // Open modal
    document.getElementById('add-contact-btn')?.addEventListener('click', () => {
        document.getElementById('new-contact-name').value = '';
        document.getElementById('new-contact-username').value = '';
        document.getElementById('new-contact-language').value = 'en';
        document.getElementById('add-contact-error').style.display = 'none';
        document.getElementById('add-contact-modal').classList.add('open');
        setTimeout(() => document.getElementById('new-contact-name').focus(), 100);
    });

    // Confirm add
    document.getElementById('confirm-add-contact')?.addEventListener('click', addNewContact);

    // Allow Enter key in name/username fields
    ['new-contact-name', 'new-contact-username'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addNewContact();
        });
    });
});

function addNewContact() {
    const nameInput = document.getElementById('new-contact-name');
    const usernameInput = document.getElementById('new-contact-username');
    const langInput = document.getElementById('new-contact-language');
    const errorEl = document.getElementById('add-contact-error');

    const name = nameInput.value.trim();
    const username = usernameInput.value.trim() || name.toLowerCase().replace(/\s+/g, '');

    // Validate
    if (!name) {
        errorEl.textContent = 'Please enter a contact name.';
        errorEl.style.display = 'block';
        nameInput.focus();
        return;
    }

    if (name.length < 2) {
        errorEl.textContent = 'Name must be at least 2 characters.';
        errorEl.style.display = 'block';
        nameInput.focus();
        return;
    }

    // Check for duplicates
    const existing = document.querySelector(`#contacts-list .contact-name`);
    const allNames = [...document.querySelectorAll('#contacts-list .contact-name')]
        .map(el => el.textContent.toLowerCase());
    if (allNames.includes(name.toLowerCase())) {
        errorEl.textContent = 'A contact with this name already exists.';
        errorEl.style.display = 'block';
        return;
    }

    const langFlags = { en:'🇬🇧', ja:'🇯🇵', ko:'🇰🇷', es:'🇪🇸', fr:'🇫🇷', de:'🇩🇪', hi:'🇮🇳', ar:'🇸🇦' };
    const flag = langFlags[langInput.value] || '🌐';
    const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const contactId = username.replace(/[^a-z0-9]/gi, '').toLowerCase() + Date.now();
    const now = 'Just now';

    // Build contact item
    const contactDiv = document.createElement('div');
    contactDiv.className = 'contact-item';
    contactDiv.dataset.contact = contactId;
    contactDiv.innerHTML = `
        <div class="contact-avatar-large">
            ${initials}
        </div>
        <div class="contact-info">
            <div class="contact-row">
                <span class="contact-name">${name}</span>
                <span class="contact-time">${now}</span>
            </div>
            <div class="contact-message">
                <span class="contact-preview">${flag} ${langInput.options[langInput.selectedIndex].text.split(' ')[1]}</span>
                <span class="contact-new-badge">NEW</span>
            </div>
        </div>
    `;

    // Add click to select
    contactDiv.addEventListener('click', () => selectContact(contactDiv));

    // Prepend to contacts list
    const list = document.getElementById('contacts-list');
    list.insertBefore(contactDiv, list.firstChild);

    // Close modal
    document.getElementById('add-contact-modal').classList.remove('open');
    window.showToast(`✅ ${name} added to contacts`, 'success');

    // Auto-select the new contact
    selectContact(contactDiv);
}