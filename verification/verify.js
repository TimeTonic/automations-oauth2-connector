const express = require('express');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

// Configuration
const MOCK_PORT = 4000;
const MIDDLEWARE_PORT = 3001; // Use a different port to avoid conflicts
const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const INCOMING_TOKEN = 'test-incoming-token';

// Mock Server (OAuth2 Provider + Target API)
const mockApp = express();
mockApp.use(express.json());
mockApp.use(express.urlencoded({ extended: true }));

let validAccessToken = 'mock-access-token';

// OAuth2 Token Endpoint
mockApp.post('/oauth/token', (req, res) => {
    const { grant_type, client_id, client_secret } = req.body;

    if (grant_type === 'client_credentials' && client_id === CLIENT_ID && client_secret === CLIENT_SECRET) {
        console.log('[Mock] Token granted');
        return res.json({
            access_token: validAccessToken,
            expires_in: 3600,
            token_type: 'Bearer'
        });
    }
    console.log('[Mock] Token denied');
    res.status(400).json({ error: 'invalid_grant' });
});

// Target API Endpoint
mockApp.get('/api/data', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${validAccessToken}`) {
        console.log('[Mock] API access granted');
        return res.json({ success: true, data: 'Secret Data' });
    }
    console.log('[Mock] API access denied');
    res.status(401).json({ error: 'Unauthorized' });
});

const mockServer = mockApp.listen(MOCK_PORT, () => {
    console.log(`[Mock] Server running on port ${MOCK_PORT}`);
});

// Start Middleware (Node.js)
console.log('[Test] Starting Middleware...');
const middlewareProcess = spawn('node', ['../node/index.js'], {
    env: {
        ...process.env,
        PORT: MIDDLEWARE_PORT,
        OAUTH_CLIENT_ID: CLIENT_ID,
        OAUTH_CLIENT_SECRET: CLIENT_SECRET,
        OAUTH_TOKEN_URL: `http://localhost:${MOCK_PORT}/oauth/token`,
        TARGET_API_BASE_URL: `http://localhost:${MOCK_PORT}/api`,
        INCOMING_BEARER_TOKEN: INCOMING_TOKEN
    },
    stdio: 'inherit'
});

// Give middleware time to start
setTimeout(async () => {
    try {
        console.log('[Test] Sending request to middleware...');
        const response = await axios.get(`http://localhost:${MIDDLEWARE_PORT}/data`, {
            headers: {
                'Authorization': `Bearer ${INCOMING_TOKEN}`
            }
        });

        console.log('[Test] Response:', response.data);

        if (response.data.success && response.data.data === 'Secret Data') {
            console.log('[Test] SUCCESS: Middleware proxied request correctly.');
        } else {
            console.error('[Test] FAILURE: Unexpected response.');
            process.exit(1);
        }

    } catch (error) {
        console.error('[Test] FAILURE:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
        process.exit(1);
    } finally {
        // Cleanup
        middlewareProcess.kill();
        mockServer.close();
        process.exit(0);
    }
}, 2000);
