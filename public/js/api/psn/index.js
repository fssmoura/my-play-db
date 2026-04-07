import { apiPost } from '../client.js';

async function getMe(npsso) {
    return apiPost('/api/psn/me', { npsso });
}

export { getMe };
