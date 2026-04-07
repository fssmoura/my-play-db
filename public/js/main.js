import { getMe } from './api/psn/index.js';

const npssoForm = document.getElementById('npsso-form');
const npssoInput = document.getElementById('npsso-input');
const output = document.getElementById('output');

async function loadProfile(npsso) {
    output.textContent = 'Loading...';
    try {
        const profile = await getMe(npsso);
        npssoForm.hidden = true;
        output.textContent = JSON.stringify(profile, null, 2);
    } catch (err) {
        sessionStorage.removeItem('npsso');
        npssoForm.hidden = false;
        output.textContent = 'Error: ' + err.message;
    }
}

document.getElementById('npsso-submit').addEventListener('click', () => {
    const npsso = npssoInput.value.trim();
    if (!npsso) return;
    sessionStorage.setItem('npsso', npsso);
    loadProfile(npsso);
});

const stored = sessionStorage.getItem('npsso');
if (stored) {
    npssoForm.hidden = true;
    loadProfile(stored);
} else {
    npssoForm.hidden = false;
}
