import { authManager } from './auth.js';
import { syncManager } from './pocketbase.js';
import { escapeHtml } from '../utils.js';

let activePollingInterval = null;

export const devicePairing = {
    modalEl: null,

    ensureModal() {
        if (this.modalEl) return this.modalEl;

        let el = document.getElementById('tv-pairing-modal');
        if (!el) {
            el = document.createElement('div');
            el.id = 'tv-pairing-modal';
            el.className = 'modal';
            el.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content tv-pair-modal-content" style="max-width: 480px; text-align: center; padding: 28px 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h3 style="margin: 0; font-size: 1.25rem; font-weight: 600;">Pair TV or Device</h3>
                        <button type="button" id="tv-pair-close-btn" class="modal-close" style="background: none; border: none; color: #888; cursor: pointer; font-size: 20px; line-height: 1;">✕</button>
                    </div>

                    <p style="color: #aaa; font-size: 0.9rem; margin-bottom: 20px; line-height: 1.4;">
                        Scan this QR code with your phone camera or visit <strong style="color: #fff;" id="tv-pair-url-text">/pair</strong> to sign in instantly.
                    </p>

                    <div id="tv-pair-qr-container" style="background: #000; border: 1px solid #333; border-radius: 12px; padding: 16px; display: inline-block; margin-bottom: 20px; min-width: 220px; min-height: 220px;">
                        <div id="tv-pair-qr-loading" style="padding: 80px 20px; color: #888; font-size: 0.85rem;">Generating QR code...</div>
                        <img id="tv-pair-qr-img" src="" alt="Pairing QR Code" style="display: none; width: 220px; height: 220px; border-radius: 8px; margin: 0 auto;" />
                    </div>

                    <div style="margin-bottom: 20px;">
                        <div style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; color: #777; margin-bottom: 6px;">Pairing Code</div>
                        <div id="tv-pair-code" style="font-family: monospace; font-size: 1.8rem; font-weight: 700; letter-spacing: 0.25em; color: #fff; background: #181818; padding: 10px 16px; border-radius: 8px; display: inline-block; border: 1px solid #2a2a2a;">
                            --- ---
                        </div>
                    </div>

                    <div id="tv-pair-status" style="font-size: 0.85rem; color: #00b4d8; display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span class="loading-dot" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #00b4d8; animation: pulse 1.5s infinite;"></span>
                        Waiting for authorization from phone...
                    </div>
                </div>
            `;
            document.body.appendChild(el);
        }

        if (!el.dataset.boundListeners) {
            el.dataset.boundListeners = 'true';
            const close = () => this.close();
            el.querySelector('#tv-pair-close-btn')?.addEventListener('click', close);
            el.querySelector('.modal-overlay')?.addEventListener('click', close);
            el.addEventListener('click', (e) => {
                if (e.target === el) close();
            });
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && el.classList.contains('active')) close();
            });
        }

        this.modalEl = el;
        return el;
    },

    async open() {
        const modal = this.ensureModal();
        modal.classList.add('active');

        const qrImg = modal.querySelector('#tv-pair-qr-img');
        const qrLoading = modal.querySelector('#tv-pair-qr-loading');
        const codeEl = modal.querySelector('#tv-pair-code');
        const urlText = modal.querySelector('#tv-pair-url-text');
        const statusEl = modal.querySelector('#tv-pair-status');

        if (qrLoading) qrLoading.style.display = 'block';
        if (qrImg) qrImg.style.display = 'none';
        if (codeEl) codeEl.textContent = '... ...';
        if (statusEl) statusEl.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#00b4d8;"></span> Generating pairing code...`;

        if (activePollingInterval) {
            clearInterval(activePollingInterval);
            activePollingInterval = null;
        }

        try {
            const res = await fetch('/api/pair/init', { method: 'POST' });
            if (!res.ok) throw new Error('Failed to create pairing session');
            const data = await res.json();

            if (qrImg && data.qrDataUrl) {
                qrImg.src = data.qrDataUrl;
                qrImg.style.display = 'block';
                if (qrLoading) qrLoading.style.display = 'none';
            }

            if (codeEl) codeEl.textContent = data.formattedCode || data.code;
            if (urlText && data.pairUrl) {
                const u = new URL(data.pairUrl);
                urlText.textContent = `${u.host}/pair`;
            }

            if (statusEl) {
                statusEl.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#00b4d8; box-shadow: 0 0 8px #00b4d8;"></span> Waiting for phone approval...`;
            }

            this.startPolling(data.pairingToken);
        } catch (err) {
            console.error('[TV Pair Init Error]', err);
            if (statusEl) {
                statusEl.innerHTML = `<span style="color:#ff4d4f;">Failed to generate pairing session. Please try again.</span>`;
            }
        }
    },

    close() {
        if (this.modalEl) {
            this.modalEl.classList.remove('active');
        }
        if (activePollingInterval) {
            clearInterval(activePollingInterval);
            activePollingInterval = null;
        }
    },

    startPolling(token) {
        if (activePollingInterval) clearInterval(activePollingInterval);

        activePollingInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/pair/status?token=${encodeURIComponent(token)}`);
                if (!res.ok) return;
                const data = await res.json();

                if (data.status === 'approved' && data.token) {
                    clearInterval(activePollingInterval);
                    activePollingInterval = null;

                    const statusEl = this.modalEl?.querySelector('#tv-pair-status');
                    if (statusEl) {
                        statusEl.innerHTML = `<span style="color:#52c41a;">✓ Approved! Signing in and syncing...</span>`;
                    }

                    // Save token
                    localStorage.setItem('echos-auth-token', data.token);
                    localStorage.setItem('monochrome-auth-token', data.token);

                    // Update AuthManager
                    if (data.user) {
                        authManager.setUser(data.user);
                    } else {
                        await authManager.refreshAuthState();
                    }

                    // Trigger Sync
                    if (authManager.user) {
                        syncManager.onAuthStateChanged(authManager.user).catch(console.error);
                    }

                    setTimeout(() => {
                        this.close();
                        alert('Device paired successfully! Your albums, playlists, and favorites are now synced.');
                    }, 1200);
                } else if (data.status === 'expired') {
                    clearInterval(activePollingInterval);
                    activePollingInterval = null;
                    const statusEl = this.modalEl?.querySelector('#tv-pair-status');
                    if (statusEl) {
                        statusEl.innerHTML = `<span style="color:#faad14;">Pairing code expired. Please close and try again.</span>`;
                    }
                }
            } catch (err) {
                console.warn('[TV Pair Poll Warning]', err);
            }
        }, 2000);
    },

    // Handles the approval flow on the phone when visiting /pair or /pair?code=...
    async handlePairApprovalUI(prefilledCode = '') {
        let overlay = document.getElementById('phone-pair-approve-modal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'phone-pair-approve-modal';
            overlay.className = 'modal';
            overlay.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content" style="max-width: 440px; text-align: center; padding: 28px 24px;">
                    <div style="font-size: 3rem; margin-bottom: 12px;">📺</div>
                    <h3 style="margin: 0 0 10px; font-size: 1.3rem;">Authorize TV / Device</h3>
                    <p style="color: #aaa; font-size: 0.9rem; margin-bottom: 20px; line-height: 1.4;">
                        A device is requesting access to your echos library, playlists, and liked albums.
                    </p>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; font-size: 0.8rem; text-transform: uppercase; color: #888; margin-bottom: 6px;">Pairing Code</label>
                        <input type="text" id="phone-pair-code-input" class="template-input" placeholder="ABCXYZ" maxlength="8"
                            style="text-align: center; font-family: monospace; font-size: 1.5rem; letter-spacing: 0.2em; text-transform: uppercase; width: 100%; max-width: 240px; margin: 0 auto;" />
                    </div>

                    <div id="phone-pair-status-msg" style="margin-bottom: 16px; font-size: 0.85rem; min-height: 20px;"></div>

                    <div style="display: flex; gap: 12px; justify-content: center;">
                        <button type="button" id="phone-pair-cancel-btn" class="btn-secondary" style="flex: 1;">Cancel</button>
                        <button type="button" id="phone-pair-approve-btn" class="btn-primary" style="flex: 1;">Approve TV</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        overlay.classList.add('active');
        const input = overlay.querySelector('#phone-pair-code-input');
        const msgEl = overlay.querySelector('#phone-pair-status-msg');
        const approveBtn = overlay.querySelector('#phone-pair-approve-btn');
        const cancelBtn = overlay.querySelector('#phone-pair-cancel-btn');

        if (input && prefilledCode) {
            input.value = prefilledCode.toUpperCase().trim();
        }

        const closeApproval = () => {
            overlay.classList.remove('active');
            window.history.replaceState({}, '', '/');
        };

        cancelBtn.onclick = closeApproval;
        overlay.querySelector('.modal-overlay').onclick = closeApproval;
        overlay.onclick = (e) => {
            if (e.target === overlay) closeApproval();
        };
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('active')) closeApproval();
        });

        approveBtn.onclick = async () => {
            const code = input.value.trim().toUpperCase();
            if (!code) {
                if (msgEl) msgEl.innerHTML = `<span style="color:#ff4d4f;">Please enter the pairing code shown on your TV.</span>`;
                return;
            }

            // Check if user is logged in
            if (!authManager.user) {
                if (msgEl) {
                    msgEl.innerHTML = `<span style="color:#faad14;">Please sign in to your echos account first. Opening sign-in...</span>`;
                }
                setTimeout(() => {
                    document.getElementById('email-auth-modal')?.classList.add('active');
                }, 800);
                return;
            }

            approveBtn.disabled = true;
            if (msgEl) msgEl.innerHTML = `<span style="color:#00b4d8;">Authorizing TV...</span>`;

            try {
                const token = localStorage.getItem('echos-auth-token') || localStorage.getItem('monochrome-auth-token');
                const res = await fetch('/api/pair/approve', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    credentials: 'include',
                    body: JSON.stringify({ code }),
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'Failed to approve device');

                if (msgEl) {
                    msgEl.innerHTML = `<span style="color:#52c41a; font-weight: 600;">✓ TV Successfully Authorized!</span>`;
                }

                setTimeout(() => {
                    closeApproval();
                    alert('TV paired! It will now automatically sync your liked music, albums, and playlists.');
                }, 1500);
            } catch (err) {
                approveBtn.disabled = false;
                if (msgEl) msgEl.innerHTML = `<span style="color:#ff4d4f;">${escapeHtml(err.message)}</span>`;
            }
        };
    },
};
