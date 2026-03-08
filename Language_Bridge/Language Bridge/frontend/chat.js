// ==================== CHAT MODULE ====================

const API_BASE = 'http://localhost:5000';
const socket = (typeof io !== 'undefined') ? io(API_BASE) : {
    connected: false,
    emit: () => {},
    on: () => {}
};

const CONTACTS_KEY = 'lb_contacts';
const CHAT_HISTORY_KEY = 'lb_chat_history';

const LANGUAGE_NAMES = {
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    hi: 'Hindi',
    ar: 'Arabic',
    zh: 'Chinese'
};

const LANGUAGE_FLAGS = {
    en: '🇬🇧',
    ja: '🇯🇵',
    ko: '🇰🇷',
    es: '🇪🇸',
    fr: '🇫🇷',
    de: '🇩🇪',
    hi: '🇮🇳',
    ar: '🇸🇦',
    zh: '🇨🇳'
};

let currentUser = null;
let currentChat = null;
let muted = localStorage.getItem('muted') === 'true';
let contactsStore = [];
let chatHistory = {};
const cloudHistoryLoading = new Set();
let chatsRealtimeUnsubscribe = null;
let activeChatRealtimeUnsubscribe = null;
let addContactInProgress = false;
let cloudRealtimeRetryTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    const userData = localStorage.getItem('currentUser');
    if (!userData) {
        window.location.href = 'index.html';
        return;
    }

    currentUser = normalizeUser(JSON.parse(userData));
    persistCurrentUser();

    contactsStore = normalizeContacts(loadStorage(getContactsStorageKey(), []));
    await upgradeLegacyContactsFromUsernameLookup();
    chatHistory = loadStorage(getChatHistoryStorageKey(), {});
    persistContacts();
    persistChatHistory();

    updateUserUI();
    renderContacts();
    setupEventListeners();
    setupSocketListeners();
    applySavedAppearance();
    updateMuteUI();

    await syncContactsFromCloud();
    renderContacts();
    setupCloudRealtimeSync();
    window.addEventListener('beforeunload', cleanupCloudSubscriptions, { once: true });

    const firstContact = document.querySelector('.contact-item');
    if (firstContact) {
        selectContact(firstContact, { silent: true });
    } else {
        resetChatHeader();
        renderConversationPlaceholder('No chat selected. Add a contact to start chatting.');
    }
});

function loadStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

function getContactsStorageKey() {
    const emailSlug = slugify(normalizeEmail(currentUser?.email || 'guest'));
    return `${CONTACTS_KEY}_${emailSlug}`;
}

function getChatHistoryStorageKey() {
    const emailSlug = slugify(normalizeEmail(currentUser?.email || 'guest'));
    return `${CHAT_HISTORY_KEY}_${emailSlug}`;
}

function normalizeUser(user) {
    const username = (user?.username || 'Guest User').trim() || 'Guest User';
    return {
        id: user?.id || Date.now(),
        username,
        email: user?.email || `${slugify(username)}@linguabridge.app`,
        language: user?.language || 'en',
        profilePhoto: user?.profilePhoto || ''
    };
}

function normalizeContacts(list) {
    if (!Array.isArray(list)) return [];
    return list
        .filter((contact) => contact && contact.name)
        .map((contact) => {
            const username = contact.username || slugify(contact.name);
            return {
                id: contact.id || `${username}-${Date.now()}`,
                name: contact.name,
                username,
                email: normalizeEmail(contact.email || ''),
                language: contact.language || 'en',
                online: Boolean(contact.online),
                lastMessage: contact.lastMessage || '',
                lastMessageTime: contact.lastMessageTime || '',
                cloudChatId: contact.cloudChatId || ''
            };
        });
}

function persistCurrentUser() {
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    window.currentUser = currentUser;
}

function persistContacts() {
    localStorage.setItem(getContactsStorageKey(), JSON.stringify(contactsStore));
}

function persistChatHistory() {
    localStorage.setItem(getChatHistoryStorageKey(), JSON.stringify(chatHistory));
}

function getInitials(name) {
    return (name || '')
        .split(' ')
        .filter(Boolean)
        .map((word) => word[0])
        .join('')
        .substring(0, 2)
        .toUpperCase() || 'NA';
}

function slugify(value) {
    return (value || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/(^\.|\.$)/g, '') || 'user';
}

function normalizeEmail(value) {
    return (value || '').trim().toLowerCase();
}

function getTimeLabelFromCloudTimestamp(value) {
    if (!value) return '';

    if (typeof value.toDate === 'function') {
        return value.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (value instanceof Date) {
        return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (typeof value?.seconds === 'number') {
        const date = new Date(value.seconds * 1000);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    return '';
}

function getContactById(contactId) {
    return contactsStore.find((contact) => contact.id === contactId) || null;
}

function upsertContactPreview(chatId, text, timeLabel = 'Now') {
    const index = contactsStore.findIndex((contact) => contact.id === chatId);
    if (index === -1) return;

    contactsStore[index].lastMessage = text;
    contactsStore[index].lastMessageTime = timeLabel;
    persistContacts();

    const contactEl = [...document.querySelectorAll('.contact-item')]
        .find((item) => item.dataset.contact === chatId);
    if (!contactEl) return;

    const preview = contactEl.querySelector('.contact-preview');
    const time = contactEl.querySelector('.contact-time');
    if (preview) preview.textContent = text;
    if (time) time.textContent = timeLabel;
}

function mergeChatsIntoContacts(chats = []) {
    const myEmail = normalizeEmail(currentUser?.email);
    if (!Array.isArray(chats) || !myEmail) return false;

    const sortedChats = [...chats].sort((left, right) => {
        const leftTime = getDateFromCloudTimestamp(left?.lastMessageAt || left?.updatedAt).getTime();
        const rightTime = getDateFromCloudTimestamp(right?.lastMessageAt || right?.updatedAt).getTime();
        return rightTime - leftTime;
    });

    let changed = false;

    sortedChats.forEach((chat) => {
        const participants = Array.isArray(chat.participants)
            ? chat.participants.map(normalizeEmail)
            : [];
        const otherEmail = participants.find((email) => email && email !== myEmail);
        if (!otherEmail) return;

        const profiles = Object.values(chat.participantProfiles || {});
        const otherProfile = profiles.find((profile) => normalizeEmail(profile?.email) === otherEmail) || {};
        const inferredName = (otherProfile.username || otherEmail.split('@')[0] || 'Contact').trim();
        const inferredUsername = slugify(otherProfile.username || inferredName);
        const messageText = chat.lastMessage || '';
        const timeLabel = getTimeLabelFromCloudTimestamp(chat.lastMessageAt || chat.updatedAt) || '';

        const existingIndex = contactsStore.findIndex((contact) =>
            normalizeEmail(contact.email) === otherEmail
        );

        if (existingIndex === -1) {
            contactsStore.unshift({
                id: `cloud-${slugify(otherEmail).replace(/\./g, '-')}`,
                name: inferredName,
                username: inferredUsername,
                email: otherEmail,
                language: 'en',
                online: false,
                lastMessage: messageText,
                lastMessageTime: timeLabel,
                cloudChatId: chat.chatId || chat.id || ''
            });
            changed = true;
            return;
        }

        const existing = contactsStore[existingIndex];
        const updated = {
            ...existing,
            id: existing.id || `cloud-${slugify(otherEmail).replace(/\./g, '-')}`,
            name: existing.name || inferredName,
            username: existing.username || inferredUsername,
            email: otherEmail,
            lastMessage: messageText || existing.lastMessage || '',
            lastMessageTime: timeLabel || existing.lastMessageTime || '',
            cloudChatId: chat.chatId || existing.cloudChatId || ''
        };

        contactsStore.splice(existingIndex, 1);
        contactsStore.unshift(updated);
        changed = true;
    });

    return changed;
}

function getDateFromCloudTimestamp(value) {
    if (!value) return new Date(0);
    if (typeof value.toDate === 'function') return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

async function upgradeLegacyContactsFromUsernameLookup() {
    const fb = window.lbFirebase;
    if (!fb?.getUsernameRecord || !Array.isArray(contactsStore) || !contactsStore.length) return;

    let changed = false;

    for (const contact of contactsStore) {
        const usernameKey = slugify(contact.username || contact.name || '');
        const currentEmail = normalizeEmail(contact.email);
        if (!usernameKey || currentEmail !== `${usernameKey}@mail.com`) continue;

        try {
            const record = await fb.getUsernameRecord(usernameKey);
            const resolvedEmail = normalizeEmail(record?.email);
            if (!resolvedEmail || resolvedEmail === currentEmail) continue;
            contact.email = resolvedEmail;
            changed = true;
        } catch (error) {
            console.warn('Legacy contact email migration skipped:', error?.message || error);
        }
    }

    if (changed) persistContacts();
}

async function syncContactsFromCloud() {
    const fb = window.lbFirebase;
    const myEmail = normalizeEmail(currentUser?.email);

    if (!fb?.getUserChats || !myEmail) return;

    try {
        const chats = await fb.getUserChats(myEmail);
        const changed = mergeChatsIntoContacts(chats);
        if (changed) {
            persistContacts();
        }
    } catch (error) {
        console.warn('Cloud contact sync failed:', error?.message || error);
    }
}

function setupCloudRealtimeSync() {
    const fb = window.lbFirebase;
    const myEmail = normalizeEmail(currentUser?.email);
    if (!fb?.subscribeUserChats || !myEmail) return;

    cleanupCloudChatSubscription();
    if (cloudRealtimeRetryTimer) {
        clearTimeout(cloudRealtimeRetryTimer);
        cloudRealtimeRetryTimer = null;
    }

    chatsRealtimeUnsubscribe = fb.subscribeUserChats(myEmail, (chats) => {
        const changed = mergeChatsIntoContacts(chats);
        if (changed) {
            persistContacts();
            renderContacts();
            restoreActiveContactSelection();
        }
    }, (error) => {
        console.warn('Realtime chat sync failed:', error?.message || error);
        scheduleCloudRealtimeRetry();
    });
}

function scheduleCloudRealtimeRetry() {
    if (cloudRealtimeRetryTimer) return;
    cloudRealtimeRetryTimer = setTimeout(() => {
        cloudRealtimeRetryTimer = null;
        setupCloudRealtimeSync();
    }, 1200);
}

function restoreActiveContactSelection() {
    if (!currentChat) return;
    const active = [...document.querySelectorAll('.contact-item')]
        .find((item) => item.dataset.contact === currentChat);
    if (!active) return;
    selectContact(active, { silent: true });
}

function cleanupCloudChatSubscription() {
    if (typeof chatsRealtimeUnsubscribe === 'function') {
        chatsRealtimeUnsubscribe();
    }
    chatsRealtimeUnsubscribe = null;
}

function cleanupActiveChatSubscription() {
    if (typeof activeChatRealtimeUnsubscribe === 'function') {
        activeChatRealtimeUnsubscribe();
    }
    activeChatRealtimeUnsubscribe = null;
}

function cleanupCloudSubscriptions() {
    cleanupCloudChatSubscription();
    cleanupActiveChatSubscription();
    if (cloudRealtimeRetryTimer) {
        clearTimeout(cloudRealtimeRetryTimer);
        cloudRealtimeRetryTimer = null;
    }
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function ensureLanguageOptionExists(select, value) {
    if (!select || !value || select.querySelector(`option[value="${value}"]`)) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value.toUpperCase();
    select.appendChild(option);
}

function setAvatar(element, name, photoUrl) {
    if (!element) return;
    if (photoUrl) {
        element.classList.add('avatar-with-image');
        element.innerHTML = `<img src="${photoUrl}" alt="${name}">`;
    } else {
        element.classList.remove('avatar-with-image');
        element.textContent = getInitials(name);
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

async function uploadProfilePhoto(file) {
    const fb = window.lbFirebase;
    if (!fb?.uploadFile || !currentUser?.id) return '';

    const path = fb.pathForProfilePhoto(currentUser.id, file.name);
    return fb.uploadFile(path, file);
}

function updateUserUI() {
    document.getElementById('header-username').textContent = currentUser.username;
    setAvatar(document.getElementById('header-avatar'), currentUser.username, currentUser.profilePhoto);

    const userLanguage = document.getElementById('user-language');
    ensureLanguageOptionExists(userLanguage, currentUser.language);
    userLanguage.value = currentUser.language;

    document.getElementById('modal-username').textContent = currentUser.username;
    document.getElementById('modal-email').textContent = currentUser.email;
    const modalLanguage = document.getElementById('modal-language-select');
    ensureLanguageOptionExists(modalLanguage, currentUser.language);
    modalLanguage.value = currentUser.language;
    setAvatar(document.getElementById('modal-avatar'), currentUser.username, currentUser.profilePhoto);
}

function renderContacts() {
    const list = document.getElementById('contacts-list');
    if (!list) return;

    list.innerHTML = '';

    if (!contactsStore.length) {
        list.innerHTML = `
            <div class="contacts-empty" id="contacts-empty">
                <i class="fas fa-user-friends"></i>
                <p>No contacts yet</p>
                <span>Click + to add a real contact and start chatting.</span>
            </div>
        `;
        return;
    }

    contactsStore.forEach((contact) => {
        const item = document.createElement('div');
        item.className = 'contact-item';
        item.dataset.contact = contact.id;
        item.dataset.username = contact.username;
        item.dataset.email = contact.email;
        item.dataset.language = contact.language;
        item.dataset.online = String(Boolean(contact.online));

        const flag = LANGUAGE_FLAGS[contact.language] || '🌐';
        const preview = contact.lastMessage || `${flag} ${LANGUAGE_NAMES[contact.language] || contact.language}`;
        const time = contact.lastMessageTime || 'Now';

        item.innerHTML = `
            <div class="contact-avatar-large">
                ${getInitials(contact.name)}
                ${contact.online ? '<span class="status-dot"></span>' : ''}
            </div>
            <div class="contact-info">
                <div class="contact-row">
                    <span class="contact-name">${contact.name}</span>
                    <span class="contact-time">${time}</span>
                </div>
                <div class="contact-message">
                    <span class="contact-preview">${preview}</span>
                </div>
            </div>
        `;

        list.appendChild(item);
    });
}

function setupEventListeners() {
    document.getElementById('send-message-btn')?.addEventListener('click', sendMessage);
    document.getElementById('message-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    document.getElementById('rail-logout-btn')?.addEventListener('click', logout);

    document.getElementById('search-contacts')?.addEventListener('input', (e) => {
        searchContacts(e.target.value);
    });

    document.getElementById('contacts-list')?.addEventListener('click', (e) => {
        const contactElement = e.target.closest('.contact-item');
        if (!contactElement) return;

        selectContact(contactElement);

        if (e.target.closest('.contact-name')) {
            openContactDrawer(getContactData(contactElement));
        }
    });

    setupOptionsDropdown();
    setupProfileEvents();
    setupContactEvents();
    setupAttachmentEvents();
    setupModalCloseHandlers();
    setupDrawerEvents();
}

function setupSocketListeners() {
    socket.on('connect', () => {
        if (currentUser) socket.emit('user-online', currentUser.id);
    });

    socket.on('new-message', async (message) => {
        // Ignore messages we sent ourselves (guard against server echo)
        if (message.sender && currentUser && message.sender === currentUser.username) return;

        const chatId = message.chatId || currentChat;
        if (!chatId) return;

        const incomingText = message.text || '';
        const myLang = currentUser?.language || 'en';
        let translation = null;

        // Translate the incoming message into the current user's own language
        if (incomingText) {
            try {
                const res = await fetch(API_BASE + '/api/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: incomingText, source_lang: 'auto', target_lang: myLang })
                });
                const data = await res.json();
                if (data.translated_text && data.translated_text !== incomingText) {
                    translation = data.translated_text;
                }
            } catch (err) {
                console.warn('Incoming message translation failed:', err);
            }
        }

        const record = {
            type: 'received',
            sender: message.sender || 'Contact',
            text: incomingText,
            translation,
            targetLanguage: myLang,
            time: formatTime()
        };

        addMessageRecord(chatId, record);
        if (chatId === currentChat) addMessageToUI(record);
        updateContactPreview(chatId, incomingText);

        if (!muted && window.showToast) {
            window.showToast(`New message from ${record.sender}`, 'info');
        }
    });
}

function setupOptionsDropdown() {
    const optionsBtn = document.getElementById('options-btn');
    const dropdown = document.getElementById('options-dropdown');
    const wrapper = document.querySelector('.options-menu-wrapper');

    optionsBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!wrapper?.contains(e.target)) dropdown.classList.remove('open');
    });

    document.getElementById('opt-profile')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        updateUserUI();
        document.getElementById('profile-modal').classList.add('open');
    });

    document.getElementById('opt-clear-chat')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        document.getElementById('clear-modal').classList.add('open');
    });

    document.getElementById('confirm-clear')?.addEventListener('click', () => {
        if (!currentChat) {
            if (window.showToast) window.showToast('No active chat to clear', 'warning');
            return;
        }
        chatHistory[currentChat] = [];
        persistChatHistory();
        renderChatHistory(currentChat);
        document.getElementById('clear-modal').classList.remove('open');
        if (window.showToast) window.showToast('Chat cleared', 'success');
    });

    document.getElementById('opt-mute')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        muted = !muted;
        localStorage.setItem('muted', muted);
        updateMuteUI();
        if (window.showToast) {
            window.showToast(muted ? 'Notifications muted' : 'Notifications unmuted', 'info');
        }
    });

    document.getElementById('opt-appearance')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        const isLight = document.body.classList.toggle('light-mode');
        localStorage.setItem('lightMode', isLight);
        updateAppearanceLabel();
        if (window.showToast) {
            window.showToast(isLight ? 'Light mode on' : 'Dark mode on', 'info');
        }
    });

    document.getElementById('opt-help')?.addEventListener('click', () => {
        dropdown.classList.remove('open');
        document.getElementById('help-modal').classList.add('open');
    });
}

function setupProfileEvents() {
    document.getElementById('change-photo-btn')?.addEventListener('click', () => {
        document.getElementById('profile-photo-input').click();
    });

    document.getElementById('profile-photo-input')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            if (window.showToast) window.showToast('Please choose an image file', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            if (window.showToast) window.showToast('Image should be smaller than 5MB', 'error');
            return;
        }

        try {
            const uploadedUrl = await uploadProfilePhoto(file);
            if (uploadedUrl) {
                currentUser.profilePhoto = uploadedUrl;
            } else {
                currentUser.profilePhoto = await readFileAsDataURL(file);
            }

            persistCurrentUser();
            updateUserUI();
            if (window.showToast) window.showToast('Profile photo updated', 'success');
        } catch (error) {
            if (window.showToast) window.showToast('Profile photo upload failed', 'error');
        }
        e.target.value = '';
    });

    document.getElementById('save-profile-btn')?.addEventListener('click', () => {
        currentUser.language = document.getElementById('modal-language-select').value;
        persistCurrentUser();
        updateUserUI();
        document.getElementById('profile-modal').classList.remove('open');
        if (window.showToast) window.showToast('Profile saved', 'success');
    });

    document.getElementById('user-language')?.addEventListener('change', (e) => {
        currentUser.language = e.target.value;
        persistCurrentUser();
        document.getElementById('modal-language-select').value = currentUser.language;
        if (window.showToast) {
            window.showToast(`Default language set to ${LANGUAGE_NAMES[currentUser.language] || currentUser.language}`, 'success');
        }
    });
}

function setupContactEvents() {
    document.getElementById('profile-info-trigger')?.addEventListener('click', () => {
        const active = getActiveContactElement();
        if (!active) return;
        openContactDrawer(getContactData(active));
    });

    document.getElementById('chat-language-select')?.addEventListener('change', (e) => {
        updateCurrentChatLanguage(e.target.value);
        translateInputText(e.target.value);
    });

    document.getElementById('messages-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.translate-btn');
        if (btn && !btn.classList.contains('loading')) translateMessageBubble(btn);
    });

    document.getElementById('add-contact-btn')?.addEventListener('click', () => {
        document.getElementById('new-contact-name').value = '';
        document.getElementById('new-contact-lookup').value = '';
        document.getElementById('new-contact-language').value = 'en';
        hideAddContactError();
        document.getElementById('add-contact-modal').classList.add('open');
        setTimeout(() => document.getElementById('new-contact-name').focus(), 100);
    });

    document.getElementById('confirm-add-contact')?.addEventListener('click', addNewContact);
    ['new-contact-name', 'new-contact-lookup'].forEach((id) => {
        document.getElementById(id)?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addNewContact();
        });
    });
}

function setupAttachmentEvents() {
    document.getElementById('attach-btn')?.addEventListener('click', () => {
        if (!currentChat) {
            if (window.showToast) window.showToast('Select a contact before attaching files', 'warning');
            return;
        }
        document.getElementById('attach-modal').classList.add('open');
    });

    document.querySelectorAll('.attach-type-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const fileInput = document.getElementById('file-upload');
            if (!fileInput) return;
            fileInput.accept = button.dataset.accept || '*/*';
            document.getElementById('attach-modal').classList.remove('open');
            fileInput.click();
        });
    });
}

function setupModalCloseHandlers() {
    document.querySelectorAll('.modal-close, [data-close]').forEach((element) => {
        element.addEventListener('click', () => {
            const id = element.dataset.close || element.closest('.modal-overlay')?.id;
            if (id) document.getElementById(id)?.classList.remove('open');
        });
    });

    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('open');
        });
    });
}

function setupDrawerEvents() {
    document.getElementById('close-contact-drawer')?.addEventListener('click', closeContactDrawer);
    document.getElementById('contact-drawer-backdrop')?.addEventListener('click', closeContactDrawer);
}

function openContactDrawer(contact) {
    if (!contact) return;
    updateContactDrawer(contact);
    document.getElementById('contact-drawer').classList.add('open');
    document.getElementById('contact-drawer-backdrop').classList.add('open');
}

function closeContactDrawer() {
    document.getElementById('contact-drawer').classList.remove('open');
    document.getElementById('contact-drawer-backdrop').classList.remove('open');
}

function updateContactDrawer(contact) {
    document.getElementById('drawer-contact-avatar').textContent = getInitials(contact.name);
    document.getElementById('drawer-contact-name').textContent = contact.name;
    document.getElementById('drawer-contact-status').textContent = contact.online ? 'Online' : 'Last seen recently';
    document.getElementById('drawer-contact-username').textContent = `@${contact.username}`;
    document.getElementById('drawer-contact-email').textContent = contact.email;
    document.getElementById('drawer-contact-language').textContent = LANGUAGE_NAMES[contact.language] || contact.language;
}

async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input?.value.trim();

    if (!currentChat) {
        if (window.showToast) window.showToast('Select a contact to start chat', 'warning');
        return;
    }
    if (!text) return;

    const activeContact = getContactById(currentChat);
    const activeEmail = normalizeEmail(activeContact?.email);
    if (!activeContact || !isValidEmail(activeEmail)) {
        if (window.showToast) window.showToast('This contact has an invalid email. Re-add the contact.', 'error');
        return;
    }

    const targetLanguage = getCurrentChatLanguage();
    const sourceLang = currentUser.language || 'en';

    let translatedText = null;
    if (targetLanguage !== sourceLang) {
        try {
            const res = await fetch(API_BASE + '/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLanguage })
            });
            const data = await res.json();
            // Only use translated text if it's actually different from the original
            // (translation service returns original text when it fails)
            if (data.translated_text && data.translated_text !== text) {
                translatedText = data.translated_text;
            }
        } catch (err) {
            console.warn('Translation failed:', err);
        }
    }

    const record = {
        type: 'sent',
        sender: currentUser.username,
        text,
        translation: translatedText,
        targetLanguage,
        time: formatTime()
    };

    addMessageRecord(currentChat, record);
    addMessageToUI(record);
    input.value = '';
    updateContactPreview(currentChat, text);

    saveMessageToCloud(record, activeContact);

    if (socket.connected) {
        socket.emit('send-message', {
            chatId: currentChat,
            text,
            sender: currentUser.username,
            targetLang: targetLanguage,
            timestamp: new Date().toISOString()
        });
    }
}

async function saveMessageToCloud(record, contact) {
    const fb = window.lbFirebase;
    const fromEmail = normalizeEmail(currentUser?.email);
    const toEmail = normalizeEmail(contact?.email);
    if (!fb?.saveChatMessage || !fromEmail || !toEmail) return;

    try {
        await fb.saveChatMessage({
            fromEmail,
            toEmail,
            fromName: currentUser.username,
            toName: contact.name || contact.username || toEmail.split('@')[0],
            text: record.text,
            translation: record.translation || null,
            targetLanguage: record.targetLanguage || 'en'
        });
    } catch (error) {
        console.warn('Cloud message save failed:', error?.message || error);
    }
}

function addMessageRecord(chatId, record) {
    if (!chatHistory[chatId]) chatHistory[chatId] = [];
    chatHistory[chatId].push(record);
    persistChatHistory();
}

function renderChatHistory(chatId) {
    const messagesList = document.getElementById('messages-list');
    messagesList.innerHTML = '';

    const records = chatHistory[chatId] || [];
    if (!records.length) {
        renderConversationPlaceholder('No messages yet. Start the conversation.');
        return;
    }

    records.forEach((record) => addMessageToUI(record));
}

function applyCloudMessagesToChat(chatId, cloudMessages) {
    if (!chatId || !Array.isArray(cloudMessages)) return;

    const fromEmail = normalizeEmail(currentUser?.email);
    const contact = getContactById(chatId);
    if (!fromEmail || !contact) return;

    const records = cloudMessages.map((msg) => {
        const sentByMe = normalizeEmail(msg.fromEmail) === fromEmail;
        return {
            type: sentByMe ? 'sent' : 'received',
            sender: sentByMe
                ? currentUser.username
                : (msg.senderName || contact.name || contact.username || 'Contact'),
            text: msg.text || '',
            translation: msg.translation || null,
            targetLanguage: msg.targetLanguage || contact.language || 'en',
            time: getTimeLabelFromCloudTimestamp(msg.createdAt) || 'Now'
        };
    });

    chatHistory[chatId] = records;
    persistChatHistory();

    const last = records[records.length - 1];
    if (last) {
        updateContactPreview(chatId, last.text, last.time);
    }

    if (currentChat === chatId) {
        renderChatHistory(chatId);
    }

    // Translate received messages that are not yet in the user's language
    translateReceivedMessages(chatId);
}

// Translates received messages in a chat into currentUser.language.
// Only processes messages that are missing a translation or are in the wrong language.
// Processes the most recent 20 to avoid too many API calls.
async function translateReceivedMessages(chatId) {
    const myLang = currentUser?.language || 'en';
    const records = chatHistory[chatId];
    if (!records) return;

    const toTranslate = records
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.type === 'received' && r.text && r.targetLanguage !== myLang)
        .slice(-20); // limit to last 20 untranslated received messages

    if (!toTranslate.length) return;

    let changed = false;
    for (const { r, i } of toTranslate) {
        try {
            const res = await fetch(API_BASE + '/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: r.text, source_lang: 'auto', target_lang: myLang })
            });
            const data = await res.json();
            if (data.translated_text && data.translated_text !== r.text) {
                records[i] = { ...records[i], translation: data.translated_text, targetLanguage: myLang };
                changed = true;
            }
        } catch (err) {
            // ignore individual failures
        }
    }

    if (changed) {
        persistChatHistory();
        if (currentChat === chatId) renderChatHistory(chatId);
    }
}

async function loadChatHistoryFromCloud(chatId) {
    if (!chatId || cloudHistoryLoading.has(chatId)) return;

    const fb = window.lbFirebase;
    const fromEmail = normalizeEmail(currentUser?.email);
    const contact = getContactById(chatId);
    const toEmail = normalizeEmail(contact?.email);
    if (!fb?.getChatMessagesByEmails || !fromEmail || !toEmail) return;

    cloudHistoryLoading.add(chatId);
    try {
        const cloudMessages = await fb.getChatMessagesByEmails(fromEmail, toEmail);
        if (!Array.isArray(cloudMessages)) return;
        applyCloudMessagesToChat(chatId, cloudMessages);
    } catch (error) {
        console.warn('Cloud chat history load failed:', error?.message || error);
    } finally {
        cloudHistoryLoading.delete(chatId);
    }
}

function subscribeToActiveChatCloudMessages(chatId) {
    cleanupActiveChatSubscription();
    if (!chatId) return;

    const fb = window.lbFirebase;
    const fromEmail = normalizeEmail(currentUser?.email);
    const contact = getContactById(chatId);
    const toEmail = normalizeEmail(contact?.email);

    if (!fb?.subscribeChatMessagesByEmails || !fromEmail || !toEmail) {
        loadChatHistoryFromCloud(chatId);
        return;
    }

    activeChatRealtimeUnsubscribe = fb.subscribeChatMessagesByEmails(fromEmail, toEmail, (cloudMessages) => {
        if (!Array.isArray(cloudMessages)) return;
        applyCloudMessagesToChat(chatId, cloudMessages);
    }, (error) => {
        console.warn('Realtime message sync failed:', error?.message || error);
        loadChatHistoryFromCloud(chatId);
    });
}

function renderConversationPlaceholder(text) {
    const messagesList = document.getElementById('messages-list');
    messagesList.innerHTML = `
        <div class="conversation-placeholder">
            <i class="fas fa-globe-asia"></i>
            <p class="conversation-placeholder-title">Language Bridge</p>
            <p class="conversation-placeholder-note">${text}</p>
            <p class="conversation-placeholder-lock"><i class="fas fa-lock"></i> Your personal messages are encrypted</p>
        </div>
    `;
}

function addMessageToUI(record) {
    const messagesList = document.getElementById('messages-list');
    const placeholder = messagesList.querySelector('.conversation-placeholder');
    if (placeholder) placeholder.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${record.type}`;

    const senderInfo = record.type === 'received'
        ? `
            <div class="message-header">
                <div class="msg-avatar-small">${getInitials(record.sender)}</div>
                <span class="msg-sender">${record.sender}</span>
            </div>
        `
        : '';

    const translationHtml = record.translation
        ? `
            <div class="message-translation" data-target-language="${record.targetLanguage || 'en'}">
                <i class="fas fa-language"></i>
                <span class="translation-text">${record.translation}</span>
                <span class="translation-tag">${(record.targetLanguage || 'en').toUpperCase()}</span>
            </div>
        `
        : '';

    messageDiv.innerHTML = `
        ${senderInfo}
        <div class="message-bubble">
            <div class="message-text">${record.text}</div>
            ${translationHtml}
            <div class="message-footer">
                <span class="message-time">${record.time || 'Just now'}</span>
                <button class="translate-btn" title="Translate message">
                    <i class="fas fa-language"></i>
                </button>
            </div>
        </div>
    `;

    messagesList.appendChild(messageDiv);
    messagesList.scrollTop = messagesList.scrollHeight;
}

// ── Per-bubble translate button ────────────────────────────────────────────

const _translateBtnCache = new Map();

async function translateMessageBubble(btn) {
    const bubble = btn.closest('.message-bubble');
    if (!bubble) return;

    const textEl = bubble.querySelector('.message-text');
    const text = textEl?.textContent?.trim();
    if (!text) return;

    const targetLang = getCurrentChatLanguage();
    if (!targetLang) return;

    const cacheKey = `${text}|${targetLang}`;

    if (_translateBtnCache.has(cacheKey)) {
        updateBubbleTranslation(bubble, _translateBtnCache.get(cacheKey), targetLang);
        return;
    }

    btn.classList.add('loading');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
        const res = await fetch(API_BASE + '/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, source_lang: 'auto', target_lang: targetLang })
        });

        if (!res.ok) {
            const errBody = await res.text();
            console.warn('Translate API error:', res.status, errBody);
            if (window.showToast) window.showToast(`Translation error (${res.status}). Try again.`, 'error');
            return;
        }

        const data = await res.json();

        if (data.error) {
            console.warn('Backend translation error:', data.error);
            if (window.showToast) window.showToast('Translation service unavailable. Try again.', 'error');
            return;
        }

        if (data.translated_text && data.translated_text !== text) {
            _translateBtnCache.set(cacheKey, data.translated_text);
            updateBubbleTranslation(bubble, data.translated_text, targetLang);
        } else {
            if (window.showToast) window.showToast('Text is already in the selected language.', 'info');
        }
    } catch (err) {
        console.warn('Translate button error:', err);
        if (window.showToast) window.showToast('Cannot reach server. Is it running?', 'error');
    } finally {
        btn.classList.remove('loading');
        btn.innerHTML = '<i class="fas fa-language"></i>';
    }
}

function updateBubbleTranslation(bubble, translatedText, targetLang) {
    let translationEl = bubble.querySelector('.message-translation');
    if (translationEl) {
        translationEl.querySelector('.translation-text').textContent = translatedText;
        translationEl.querySelector('.translation-tag').textContent = targetLang.toUpperCase();
        translationEl.dataset.targetLanguage = targetLang;
    } else {
        const footer = bubble.querySelector('.message-footer');
        const div = document.createElement('div');
        div.className = 'message-translation';
        div.dataset.targetLanguage = targetLang;
        div.innerHTML = `
            <i class="fas fa-language"></i>
            <span class="translation-text">${translatedText}</span>
            <span class="translation-tag">${targetLang.toUpperCase()}</span>
        `;
        bubble.insertBefore(div, footer);
    }
}

function selectContact(contactElement, options = {}) {
    document.querySelectorAll('.contact-item').forEach((item) => item.classList.remove('active'));
    contactElement.classList.add('active');

    currentChat = contactElement.dataset.contact;
    const contact = getContactData(contactElement);

    updateChatHeader(contact);
    updateContactDrawer(contact);

    // Only reset the language selector when the user explicitly picks a contact.
    // Silent restores (triggered by cloud sync) must not overwrite the user's choice.
    if (!options.silent) {
        const chatLanguage = document.getElementById('chat-language-select');
        ensureLanguageOptionExists(chatLanguage, contact.language);
        chatLanguage.value = contact.language;
    }

    renderChatHistory(currentChat);
    loadChatHistoryFromCloud(currentChat);
    subscribeToActiveChatCloudMessages(currentChat);

    if (!options.silent && window.showToast) {
        window.showToast(`Chat with ${contact.name}`, 'info');
    }
}

function updateChatHeader(contact) {
    const profileAvatar = document.getElementById('profile-avatar');
    profileAvatar.innerHTML = `${getInitials(contact.name)}${contact.online ? '<span class="status-dot"></span>' : ''}`;

    document.getElementById('profile-name').textContent = contact.name;
    document.getElementById('profile-meta').textContent = `@${contact.username} • ${contact.email}`;
}

function resetChatHeader() {
    document.getElementById('profile-avatar').textContent = 'NA';
    document.getElementById('profile-name').textContent = 'No contact selected';
    document.getElementById('profile-meta').textContent = 'Select a contact from the left panel';
}

function getActiveContactElement() {
    return document.querySelector('.contact-item.active');
}

function getContactData(contactElement) {
    return {
        id: contactElement.dataset.contact,
        name: contactElement.querySelector('.contact-name')?.textContent?.trim() || 'Unknown User',
        username: contactElement.dataset.username || 'unknown.user',
        email: contactElement.dataset.email || '',
        language: contactElement.dataset.language || 'en',
        online: contactElement.dataset.online === 'true'
    };
}

function getCurrentChatLanguage() {
    // Read directly from the dropdown — it's always what the user actually selected
    const select = document.getElementById('chat-language-select');
    return select?.value || getActiveContactElement()?.dataset.language || 'en';
}

function getContactLanguage(chatId) {
    const fromStore = contactsStore.find((contact) => contact.id === chatId);
    return fromStore?.language || 'en';
}

function updateCurrentChatLanguage(languageCode) {
    const active = getActiveContactElement();
    if (!active) {
        if (window.showToast) window.showToast('Select a contact first', 'warning');
        return;
    }

    active.dataset.language = languageCode;
    const index = contactsStore.findIndex((contact) => contact.id === active.dataset.contact);
    if (index !== -1) {
        contactsStore[index].language = languageCode;
        persistContacts();
    }

    refreshTranslationTags(languageCode);
    updateContactDrawer(getContactData(active));

    if (window.showToast) {
        window.showToast(`Chat language changed to ${LANGUAGE_NAMES[languageCode] || languageCode}`, 'success');
    }
}

// Translates the text currently typed in the message input into targetLang.
// Called instantly when the user switches the chat language selector.
async function translateInputText(targetLang) {
    const input = document.getElementById('message-input');
    const text = input?.value.trim();
    if (!text || !targetLang) return;

    try {
        const res = await fetch(API_BASE + '/api/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, source_lang: 'auto', target_lang: targetLang })
        });
        const data = await res.json();
        if (data.translated_text && data.translated_text !== text) {
            input.value = data.translated_text;
        }
    } catch (err) {
        console.warn('Input translation failed:', err);
    }
}

function refreshTranslationTags(languageCode) {
    document.querySelectorAll('.message-translation').forEach((translation) => {
        translation.dataset.targetLanguage = languageCode;
        const tag = translation.querySelector('.translation-tag');
        if (tag) tag.textContent = languageCode.toUpperCase();
    });
}

function searchContacts(query) {
    const term = query.toLowerCase().trim();
    document.querySelectorAll('.contact-item').forEach((contact) => {
        const data = getContactData(contact);
        const preview = contact.querySelector('.contact-preview')?.textContent?.toLowerCase() || '';
        const searchable = `${data.name} ${data.username} ${data.email} ${preview}`.toLowerCase();
        contact.style.display = searchable.includes(term) ? 'flex' : 'none';
    });
}

function setAddContactLoading(isLoading) {
    const button = document.getElementById('confirm-add-contact');
    if (!button) return;

    if (isLoading) {
        if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
        return;
    }

    button.disabled = false;
    if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
    }
}

async function resolveLookupToContactIdentity(rawLookup) {
    const lookup = normalizeEmail(rawLookup);
    if (!lookup) {
        return { email: '', username: '', error: 'Please enter user ID or email.' };
    }

    if (lookup.includes('@')) {
        if (!isValidEmail(lookup)) {
            return { email: '', username: '', error: 'Please enter a valid email.' };
        }

        return {
            email: lookup,
            username: slugify(lookup.split('@')[0] || 'user'),
            error: ''
        };
    }

    const fb = window.lbFirebase;
    if (!fb?.getUsernameRecord) {
        return { email: '', username: '', error: 'Username lookup is unavailable. Please use email.' };
    }

    try {
        const record = await fb.getUsernameRecord(slugify(lookup));
        const email = normalizeEmail(record?.email);
        if (!email) {
            return { email: '', username: '', error: 'User ID not found. Please enter a valid email.' };
        }

        return {
            email,
            username: slugify(record?.username || lookup),
            error: ''
        };
    } catch (error) {
        return { email: '', username: '', error: 'User ID lookup failed. Please use email.' };
    }
}

async function addNewContact() {
    if (addContactInProgress) return;

    const nameInput = document.getElementById('new-contact-name');
    const lookupInput = document.getElementById('new-contact-lookup');
    const languageInput = document.getElementById('new-contact-language');

    const name = nameInput.value.trim();
    const lookup = lookupInput.value.trim();
    const language = languageInput.value;

    if (!name) {
        showAddContactError('Please enter a contact name.');
        nameInput.focus();
        return;
    }

    if (!lookup) {
        showAddContactError('Please enter user ID or email.');
        lookupInput.focus();
        return;
    }

    addContactInProgress = true;
    setAddContactLoading(true);

    try {
        const resolved = await resolveLookupToContactIdentity(lookup);
        if (resolved.error) {
            showAddContactError(resolved.error);
            return;
        }

        const email = normalizeEmail(resolved.email);
        const username = resolved.username || slugify(email.split('@')[0] || name);
        const myEmail = normalizeEmail(currentUser?.email);

        if (!email || !isValidEmail(email)) {
            showAddContactError('Please enter a valid registered email.');
            return;
        }

        if (email === myEmail) {
            showAddContactError('You cannot add your own account as a contact.');
            return;
        }

        const duplicate = contactsStore.some((contact) =>
            normalizeEmail(contact.email) === email
        );

        if (duplicate) {
            showAddContactError('Contact already exists with this email.');
            return;
        }

        hideAddContactError();

        const contact = {
            id: `${username.replace(/[^a-z0-9]/g, '')}-${Date.now()}`,
            name,
            username,
            email,
            language,
            online: false,
            lastMessage: '',
            lastMessageTime: '',
            cloudChatId: ''
        };

        contactsStore.unshift(contact);
        persistContacts();
        renderContacts();

        document.getElementById('add-contact-modal').classList.remove('open');

        const newElement = [...document.querySelectorAll('.contact-item')]
            .find((item) => item.dataset.contact === contact.id);
        if (newElement) selectContact(newElement, { silent: true });

        if (window.showToast) window.showToast(`${name} added to contacts`, 'success');
    } finally {
        addContactInProgress = false;
        setAddContactLoading(false);
    }
}

function showAddContactError(message) {
    const errorEl = document.getElementById('add-contact-error');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
}

function hideAddContactError() {
    const errorEl = document.getElementById('add-contact-error');
    errorEl.textContent = '';
    errorEl.style.display = 'none';
}

function updateContactPreview(chatId, text, timeLabel = 'Now') {
    upsertContactPreview(chatId, text, timeLabel);
}

function formatTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getDemoTranslation(text, languageCode) {
    if (!text || languageCode === 'en') return null;
    return `${LANGUAGE_NAMES[languageCode] || languageCode}: ${text}`;
}

async function logout() {
    if (socket.connected) socket.emit('user-offline', currentUser?.id);
    cleanupCloudSubscriptions();
    try {
        if (window.firebaseSignOut) {
            await window.firebaseSignOut();
        }
    } catch (error) {
        console.warn('Firebase sign-out failed:', error?.message || error);
    }
    localStorage.removeItem('currentUser');
    window.currentUser = null;
    if (window.showToast) window.showToast('Logged out successfully', 'info');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 900);
}

function updateAppearanceLabel() {
    const label = document.querySelector('#opt-appearance span');
    if (!label) return;
    label.textContent = document.body.classList.contains('light-mode') ? 'Dark Mode' : 'Light Mode';
}

function applySavedAppearance() {
    const isLight = localStorage.getItem('lightMode') === 'true';
    if (isLight) document.body.classList.add('light-mode');
    updateAppearanceLabel();
}

function updateMuteUI() {
    const icon = document.getElementById('mute-icon');
    const label = document.getElementById('mute-label');
    if (!icon || !label) return;
    icon.className = muted ? 'fas fa-bell-slash' : 'fas fa-bell';
    label.textContent = muted ? 'Unmute Notifications' : 'Mute Notifications';
}
