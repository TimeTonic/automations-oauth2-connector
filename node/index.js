const express = require('express');
const axios = require('axios');
require('dotenv').config({ path: '../.env' }); // Load from parent directory

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const CONFIG = {
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    tokenUrl: process.env.OAUTH_TOKEN_URL,
    targetApiBaseUrl: process.env.TARGET_API_BASE_URL,
    incomingBearerToken: process.env.INCOMING_BEARER_TOKEN
};

// Token Cache
let tokenCache = {
    accessToken: null,
    expiresAt: 0
};

// Helper: Get OAuth2 Token
async function getAccessToken() {
    const now = Date.now();
    
    // Return cached token if valid (with 10s buffer)
    if (tokenCache.accessToken && tokenCache.expiresAt > now + 10000) {
        return tokenCache.accessToken;
    }

    console.log('Fetching new access token...');
    
    try {
        const response = await axios.post(CONFIG.tokenUrl, {
            grant_type: 'client_credentials',
            client_id: CONFIG.clientId,
            client_secret: CONFIG.clientSecret
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded' // Standard for OAuth2
            }
        });

        const { access_token, expires_in } = response.data;
        
        tokenCache.accessToken = access_token;
        // expires_in is usually in seconds
        tokenCache.expiresAt = now + (expires_in * 1000);
        
        console.log('Token refreshed successfully.');
        return access_token;
    } catch (error) {
        console.error('Error fetching access token:', error.response ? error.response.data : error.message);
        throw new Error('Failed to authenticate with upstream API');
    }
}

// Middleware: Auth Check
app.use((req, res, next) => {
    if (CONFIG.incomingBearerToken) {
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${CONFIG.incomingBearerToken}`) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or missing Bearer token' });
        }
    }
    next();
});

// Catch-all Proxy Route
app.all('*', async (req, res) => {
    try {
        const upstreamToken = await getAccessToken();
        
        // Construct upstream URL
        // req.path includes the leading slash
        const targetUrl = `${CONFIG.targetApiBaseUrl}${req.path}`;
        
        console.log(`Proxying ${req.method} request to: ${targetUrl}`);

        // Forward request
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: {
                ...req.headers,
                'Authorization': `Bearer ${upstreamToken}`,
                'Host': undefined // Let axios set the host
            },
            data: req.method === 'GET' ? undefined : req, // Stream the body for non-GET
            validateStatus: () => true, // Don't throw on error status
            responseType: 'stream' // Stream response back
        });

        // Forward status and headers
        res.status(response.status);
        Object.keys(response.headers).forEach(key => {
            res.setHeader(key, response.headers[key]);
        });

        // Pipe data
        response.data.pipe(res);

    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(502).json({ error: 'Bad Gateway', details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Node.js Middleware running on port ${PORT}`);
});
