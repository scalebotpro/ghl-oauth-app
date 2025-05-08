require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory token store (in production, use a database)
const tokenStore = {};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Home route
app.get('/', (req, res) => {
  res.send(`
    <h1>SYR Ads Engine OAuth Integration</h1>
    <p>Redirect URI: <code>${process.env.REDIRECT_URI}</code></p>
    <p>Status: <strong>Ready to connect</strong></p>
    <a href="/auth/start" class="button">Connect to GoHighLevel</a>
    <style>
      body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
      .button { display: inline-block; background: #4361ee; color: white; padding: 12px 24px; 
                text-decoration: none; border-radius: 4px; margin-top: 20px; }
    </style>
  `);
});

// Start OAuth flow
app.get('/auth/start', (req, res) => {
  const clientId = process.env.GHL_CLIENT_ID;
  const redirectUri = process.env.REDIRECT_URI;
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
        redirect_uri: process.env.REDIRECT_URI,
      });
      
      const { access_token, refresh_token, expires_in } = tokenResponse.data;
      
      // Store tokens
      tokenStore[locationId] = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: Date.now() + (expires_in * 1000),
      };
      
      console.log(`Tokens stored for location ${locationId}`);
      
      // Show success page
      res.send(`
        <h1>Authorization Successful!</h1>
        <h2>Your GoHighLevel location is now connected!</h2>
        <p>You can now use the SYR Ads Engine with your GoHighLevel account.</p>
        <div>
          <h3>Connection Details:</h3>
          <p>Location ID: ${locationId}</p>
          <p>Status: <span style="color: green; font-weight: bold;">Active</span></p>
          <p>Expires: In ${Math.floor(expires_in / 60 / 60)} hours</p>
        </div>
        <a href="/dashboard?locationId=${locationId}" style="display: inline-block; background: #4361ee; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px;">Go to Dashboard</a>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        </style>
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

// Simple dashboard to test the tokens
app.get('/dashboard', async (req, res) => {
  const { locationId } = req.query;
  
  if (!locationId || !tokenStore[locationId]) {
    return res.redirect('/');
  }
  
  const tokenData = tokenStore[locationId];
  
  // Check if token is expired and needs refresh
  if (tokenData.expiresAt < Date.now()) {
    try {
      // Refresh token
      const refreshResponse = await axios.post('https://services.leadconnectorhq.com/oauth/token', {
        client_id: process.env.GHL_CLIENT_ID,
        client_secret: process.env.GHL_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: tokenData.refreshToken,
      });
      
      const { access_token, refresh_token, expires_in } = refreshResponse.data;
      
      // Update stored tokens
      tokenStore[locationId] = {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: Date.now() + (expires_in * 1000),
      };
      
      console.log(`Tokens refreshed for location ${locationId}`);
    } catch (error) {
      console.error('Token refresh error:', error.response?.data || error.message);
      return res.redirect('/');
    }
  }
  
  // Use the token to get location info
  try {
    const locationResponse = await axios.get(`https://services.leadconnectorhq.com/locations/${locationId}`, {
      headers: {
        'Authorization': `Bearer ${tokenStore[locationId].accessToken}`,
        'Version': '2021-04-15'
      }
    });
    
    const locationData = locationResponse.data;
    
    res.send(`
      <h1>SYR Ads Engine Dashboard</h1>
      <h2>Location: ${locationData.name || 'Unknown'}</h2>
      
      <div class="card">
        <h3>Connection Status</h3>
        <p>Location ID: ${locationId}</p>
        <p>Status: <span style="color: green; font-weight: bold;">Connected</span></p>
        <p>Token expires in: ${Math.floor((tokenStore[locationId].expiresAt - Date.now()) / 1000 / 60)} minutes</p>
      </div>
      
      <div class="card">
        <h3>Actions</h3>
        <a href="/api/test-submission?locationId=${locationId}" class="button">Test Submission</a>
        <a href="/" class="button secondary">Back to Home</a>
      </div>
      
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .card { background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
        .button { display: inline-block; background: #4361ee; color: white; padding: 12px 24px; 
                text-decoration: none; border-radius: 4px; margin-right: 10px; }
        .button.secondary { background: #6c757d; }
      </style>
    `);
    
  } catch (error) {
    console.error('Error fetching location data:', error.response?.data || error.message);
    res.send(`
      <h1>Error</h1>
      <p>Could not fetch location data. Token may be invalid.</p>
      <a href="/">Back to Home</a>
    `);
  }
});

// Test API endpoint
app.get('/api/test-submission', async (req, res) => {
  const { locationId } = req.query;
  
  if (!locationId || !tokenStore[locationId]) {
    return res.status(400).json({ error: 'Invalid or missing location ID' });
  }
  
  // Get token from store
  const tokenData = tokenStore[locationId];
  
  // Simple test - increment a custom field on a test contact
  try {
    // First, let's create a test contact if it doesn't exist
    const contactResponse = await axios.post(`https://services.leadconnectorhq.com/contacts/`, {
      locationId: locationId,
      email: `test-${locationId}@syradsengine.com`,
      firstName: 'SYR',
      lastName: 'Test',
      customFields: [
        { key: 'ads_engine_submissions_used', value: '0' },
        { key: 'ads_engine_submissions_limit', value: '10' }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${tokenData.accessToken}`,
        'Version': '2021-04-15',
        'Content-Type': 'application/json'
      }
    });
    
    const contactId = contactResponse.data.id;
    
    // Now, increment the submissions counter
    const currentValue = parseInt(contactResponse.data.customFields.find(f => f.key === 'ads_engine_submissions_used')?.value || '0');
    const newValue = currentValue + 1;
    
    await axios.put(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      customFields: [
        { key: 'ads_engine_submissions_used', value: newValue.toString() }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${tokenData.accessToken}`,
        'Version': '2021-04-15',
        'Content-Type': 'application/json'
      }
    });
    
    // Redirect back to dashboard with success message
    res.send(`
      <h1>Test Successful!</h1>
      <p>Successfully created/updated test contact and incremented submission counter.</p>
      <p>New submissions count: ${newValue}</p>
      <a href="/dashboard?locationId=${locationId}" style="display: inline-block; background: #4361ee; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin-top: 20px;">Back to Dashboard</a>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
      </style>
    `);
    
  } catch (error) {
    console.error('API test error:', error.response?.data || error.message);
    res.status(500).send(`
      <h1>Test Failed</h1>
      <p>Error: ${error.message}</p>
      <pre>${JSON.stringify(error.response?.data || {}, null, 2)}</pre>
      <a href="/dashboard?locationId=${locationId}">Back to Dashboard</a>
    `);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
