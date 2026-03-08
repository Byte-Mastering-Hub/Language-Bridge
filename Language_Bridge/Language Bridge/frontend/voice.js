// ==================== VOICE MODULE ====================

let mediaRecorder = null;
let audioChunks = [];
let recordingTimer = null;
let recordingSeconds = 0;

document.addEventListener('DOMContentLoaded', () => {
    const voiceBtn = document.getElementById('voice-record-btn');
    const stopBtn = document.getElementById('stop-recording');
    const cancelBtn = document.getElementById('cancel-recording');

    if (voiceBtn) voiceBtn.addEventListener('click', startRecording);
    if (stopBtn) stopBtn.addEventListener('click', stopRecording);
    if (cancelBtn) cancelBtn.addEventListener('click', cancelRecording);
});

async function startRecording() {
    if (!document.querySelector('.contact-item.active')) {
        if (window.showToast) window.showToast('Select a contact before recording audio', 'warning');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        recordingSeconds = 0;

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            addVoiceMessage(audioBlob);
            stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start();

        document.getElementById('recording-indicator').classList.remove('hidden');
        document.getElementById('recording-timer').textContent = '0:00';

        recordingTimer = setInterval(() => {
            recordingSeconds++;
            const mins = Math.floor(recordingSeconds / 60);
            const secs = recordingSeconds % 60;
            document.getElementById('recording-timer').textContent =
                `${mins}:${secs.toString().padStart(2, '0')}`;
        }, 1000);

        if (window.showToast) window.showToast('🎙️ Recording...', 'info');
    } catch (err) {
        if (window.showToast) window.showToast('Microphone access denied', 'error');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    clearInterval(recordingTimer);
    document.getElementById('recording-indicator').classList.add('hidden');
}

function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.ondataavailable = null;
        mediaRecorder.onstop = null;
        mediaRecorder.stop();
        if (mediaRecorder.stream) {
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
    }
    audioChunks = [];
    clearInterval(recordingTimer);
    document.getElementById('recording-indicator').classList.add('hidden');
    if (window.showToast) window.showToast('Recording cancelled', 'info');
}

function addVoiceMessage(audioBlob) {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;

    const url = URL.createObjectURL(audioBlob);
    const mins = Math.floor(recordingSeconds / 60);
    const secs = recordingSeconds % 60;
    const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message sent';
    messageDiv.innerHTML = `
        <div class="message-bubble">
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
                <span class="voice-duration">${durationStr}</span>
                <audio src="${url}" style="display:none"></audio>
            </div>
            <span class="message-time">Just now</span>
        </div>
    `;

    const playBtn = messageDiv.querySelector('.voice-play');
    const audio = messageDiv.querySelector('audio');
    const icon = playBtn.querySelector('i');

    playBtn.addEventListener('click', () => {
        if (audio.paused) {
            audio.play();
            icon.classList.replace('fa-play', 'fa-pause');
        } else {
            audio.pause();
            icon.classList.replace('fa-pause', 'fa-play');
        }
    });

    audio.addEventListener('ended', () => {
        icon.classList.replace('fa-pause', 'fa-play');
    });

    messagesList.appendChild(messageDiv);
    messagesList.scrollTop = messagesList.scrollHeight;
    if (window.showToast) window.showToast('🎙️ Voice message sent', 'success');
}
