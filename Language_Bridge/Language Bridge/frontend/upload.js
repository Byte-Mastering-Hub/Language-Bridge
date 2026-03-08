// ==================== FILE UPLOAD MODULE ====================

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-upload');

    if (fileInput) {
        fileInput.addEventListener('change', handleFileUpload);
    }
});

function escapeHtml(value) {
    return (value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function uploadAttachmentToStorage(file) {
    const fb = window.lbFirebase;
    const currentUser = window.currentUser;

    if (!fb?.uploadFile || !currentUser?.id) return '';

    const path = fb.pathForAttachment(currentUser.id, file.name);
    return fb.uploadFile(path, file);
}

async function handleFileUpload(event) {
    if (!document.querySelector('.contact-item.active')) {
        if (window.showToast) window.showToast('Select a contact before sending attachments', 'warning');
        event.target.value = '';
        return;
    }

    const files = [...(event.target.files || [])];
    if (!files.length) return;

    for (const file of files) {
        if (file.size > 16 * 1024 * 1024) {
            if (window.showToast) window.showToast(`File too large: ${file.name} (max 16MB)`, 'error');
            continue;
        }

        if (window.showToast) {
            window.showToast(`Uploading ${file.name}...`, 'info');
        }

        try {
            const fileUrl = await uploadAttachmentToStorage(file);
            displayFileInChat(file, fileUrl);
            if (window.showToast) window.showToast(`${file.name} uploaded`, 'success');
        } catch (error) {
            if (window.showToast) window.showToast(`Upload failed: ${file.name}`, 'error');
        }
    }

    event.target.value = '';
}

function displayFileInChat(file, fileUrl = '') {
    const messagesList = document.getElementById('messages-list');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message sent';

    if (file.type.startsWith('image/')) {
        if (fileUrl) {
            messageDiv.innerHTML = `
                <div class="message-bubble">
                    <div class="image-container">
                        <img src="${fileUrl}" alt="Uploaded image">
                        <a class="image-overlay" href="${fileUrl}" target="_blank" rel="noopener noreferrer" title="Open image">
                            <i class="fas fa-download"></i>
                        </a>
                    </div>
                    <span class="message-time">Just now</span>
                </div>
            `;
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                messageDiv.innerHTML = `
                    <div class="message-bubble">
                        <div class="image-container">
                            <img src="${e.target.result}" alt="Uploaded image">
                            <div class="image-overlay">
                                <i class="fas fa-download"></i>
                            </div>
                        </div>
                        <span class="message-time">Just now</span>
                    </div>
                `;
            };
            reader.readAsDataURL(file);
        }
    } else {
        const fileIcon = getFileIcon(file.name);
        const fileSize = (file.size / 1024 / 1024).toFixed(1);
        const safeName = escapeHtml(file.name);
        const downloadHtml = fileUrl
            ? `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer" class="file-download" title="Download"><i class="fas fa-download"></i></a>`
            : '<i class="fas fa-download file-download"></i>';

        messageDiv.innerHTML = `
            <div class="message-bubble">
                <div class="file-container">
                    <i class="fas ${fileIcon} file-icon"></i>
                    <div class="file-details">
                        <div class="file-name">${safeName}</div>
                        <div class="file-meta">${fileSize} MB</div>
                    </div>
                    ${downloadHtml}
                </div>
                <span class="message-time">Just now</span>
            </div>
        `;
    }

    messagesList.appendChild(messageDiv);
    messagesList.scrollTop = messagesList.scrollHeight;
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();

    const icons = {
        pdf: 'fa-file-pdf',
        doc: 'fa-file-word',
        docx: 'fa-file-word',
        xls: 'fa-file-excel',
        xlsx: 'fa-file-excel',
        ppt: 'fa-file-powerpoint',
        pptx: 'fa-file-powerpoint',
        txt: 'fa-file-alt',
        zip: 'fa-file-archive',
        rar: 'fa-file-archive',
        mp3: 'fa-file-audio',
        wav: 'fa-file-audio',
        mp4: 'fa-file-video',
        mov: 'fa-file-video',
        jpg: 'fa-file-image',
        jpeg: 'fa-file-image',
        png: 'fa-file-image',
        gif: 'fa-file-image'
    };

    return icons[ext] || 'fa-file';
}
