require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Home route
app.get('/', (req, res) => {
  res.send(`
    <h1>GoHighLevel OAuth App</h1>
    <p>Redirect URI: <code>${process.env.REDIRECT_URI || 'https://your-app.com/authorize-handler'}</code></p>
    <a href="/auth/start">Test Authorization</a>
  `);
});

// Start OAuth flow
app.get('/auth/start', (req, res) => {
  const clientId = process.env.GHL_CLIENT_ID;
  const redirectUri = process.env.REDIRECT_URI || 'https://your-app.com/authorize-handler';
  const scope = 'contacts.readonly contacts.write custom_values.readonly custom_values.write opportunities.readonly opportunities.write tags.readonly tags.write locations.readonly';
  
  const authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`;
  
  res.redirect(authUrl);
});

// Receive authorization code
app.get('/authorize-handler', async (req, res) => {
  try {
    const { code, locationId } = req.query;
    
    if (!code || !locationId) {
      return res.status(400).send('Missing auth code or location ID');
    }
    
    console.log('Auth Code Received:', code);
    console.log('Location ID:', locationId);
    
    // Exchange code for tokens
    try {
      const tokenResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
        client_id: process.env.GHL_CLIENT_ID,
        client_secret: process.env.GHL_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI || 'https://your-app.com/authorize-handler',
      });
      
      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      
      res.send(`
        <h1>Authorization Successful!</h1>
        <h2>Token Info:</h2>
        <pre>
          Access Token: ${access_token.substring(0, 10)}...
          Refresh Token: ${refresh_token.substring(0, 10)}...
          Expires In: ${expires_in} seconds
          Location ID: ${locationId}
        </pre>
      `);
      
    } catch (error) {
      console.error('Token exchange error:', error.response?.data || error.message);
      res.status(500).send(`Token exchange failed: ${error.message}`);
    }
    
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).send(`Authorization error: ${error.message}`);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
