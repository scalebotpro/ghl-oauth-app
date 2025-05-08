require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// GHL API configuration
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'lKWthVWigQO6xfZysNgf';

// GHL API helper functions
async function getContactByEmail(email) {
  try {
    // Search for contact by email
    const response = await axios.get(`https://services.leadconnectorhq.com/contacts/?email=${encodeURIComponent(email)}&locationId=${GHL_LOCATION_ID}`, {
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-04-15'
      }
    });
    
    // Return the first contact if found
    if (response.data.contacts && response.data.contacts.length > 0) {
      return response.data.contacts[0];
    }
    
    return null;
  } catch (error) {
    console.error('Error getting contact by email:', error.response?.data || error.message);
    throw error;
  }
}

async function updateSubmissionCount(contactId, currentCount) {
  const newCount = currentCount + 1;
  
  try {
    await axios.put(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
      customFields: [
        { key: 'ads_engine_submissions_used', value: newCount.toString() }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-04-15',
        'Content-Type': 'application/json'
      }
    });
    
    return newCount;
  } catch (error) {
    console.error('Error updating submission count:', error.response?.data || error.message);
    throw error;
  }
}

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Home route
app.get('/', (req, res) => {
  res.send(`
    <h1>SYR Ads Engine API</h1>
    <p>This service tracks ad generation usage for SYR Ads Engine customers.</p>
    <p>Status: <strong>Running</strong></p>
    <style>
      body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    </style>
  `);
});

// User dashboard route - for displaying usage stats
app.get('/dashboard', async (req, res) => {
  const userEmail = req.query.email;
  
  if (!userEmail) {
    return res.status(400).send('Missing email parameter');
  }
  
  try {
    // Get contact from GHL
    const contact = await getContactByEmail(userEmail);
    
    if (!contact) {
      return res.status(404).send(`
        <h1>User Not Found</h1>
        <p>We couldn't find a user with email: ${userEmail}</p>
        <a href="/">Back to Home</a>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        </style>
      `);
    }
    
    // Get custom fields
    const customFields = contact.customFields || [];
    const submissionsUsed = customFields.find(f => f.key === 'ads_engine_submissions_used')?.value || '0';
    const submissionsLimit = customFields.find(f => f.key === 'ads_engine_submissions_limit')?.value || '10';
    
    // Calculate stats
    const used = parseInt(submissionsUsed) || 0;
    const limit = parseInt(submissionsLimit) || 10;
    const remaining = Math.max(0, limit - used);
    const percentUsed = Math.min(100, Math.round((used / limit) * 100));
    
    res.send(`
      <h1>SYR Ads Engine Dashboard</h1>
      <h2>Welcome, ${contact.firstName || 'User'}</h2>
      
      <div class="card">
        <h3>Ad Generation Usage</h3>
        <div class="progress-container">
          <div class="progress-bar" style="width: ${percentUsed}%"></div>
        </div>
        <div class="stats">
          <div class="stat">
            <span class="value">${used}</span>
            <span class="label">Used</span>
          </div>
          <div class="stat">
            <span class="value">${remaining}</span>
            <span class="label">Remaining</span>
          </div>
          <div class="stat">
            <span class="value">${limit}</span>
            <span class="label">Total</span>
          </div>
        </div>
      </div>
      
      <div class="card">
        <h3>Actions</h3>
        <a href="https://scalebot.io/ads-generator" class="button">Generate New Ads</a>
        ${remaining <= 0 ? 
          `<a href="https://scalebot.io/upgrade" class="button upgrade">Upgrade Your Plan</a>` : 
          ''
        }
      </div>
      
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .card { background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        .progress-container { width: 100%; height: 20px; background-color: #e9ecef; border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
        .progress-bar { height: 100%; background: linear-gradient(to right, #4361ee, #3a86ff); border-radius: 10px; }
        .stats { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .stat { text-align: center; flex: 1; }
        .value { font-size: 24px; font-weight: bold; display: block; }
        .label { font-size: 14px; color: #6c757d; }
        .button { display: inline-block; background: #4361ee; color: white; padding: 12px 24px; 
                text-decoration: none; border-radius: 4px; margin-right: 10px; }
        .button.upgrade { background: #10b981; }
      </style>
    `);
    
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).send(`
      <h1>Error</h1>
      <p>Could not fetch user data. Please try again later.</p>
      <p>Error: ${error.message}</p>
      <a href="/">Back to Home</a>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
      </style>
    `);
  }
});

// API endpoint to track ad submissions
app.post('/api/track-submission', async (req, res) => {
  try {
    // Expected payload: { email, adGenerationId }
    const { email, adGenerationId } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Missing email parameter' });
    }
    
    // Get contact from GHL
    const contact = await getContactByEmail(email);
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    // Get current submission count and limit
    const customFields = contact.customFields || [];
    const submissionsUsed = parseInt(customFields.find(f => f.key === 'ads_engine_submissions_used')?.value || '0');
    const submissionsLimit = parseInt(customFields.find(f => f.key === 'ads_engine_submissions_limit')?.value || '10');
    
    // Check if user has submissions remaining
    if (submissionsUsed >= submissionsLimit) {
      return res.status(403).json({ 
        error: 'Submission limit reached',
        limit: submissionsLimit,
        used: submissionsUsed,
        contactId: contact.id,
        adGenerationId
      });
    }
    
    // Increment submission count
    const newCount = await updateSubmissionCount(contact.id, submissionsUsed);
    
    // Return updated status
    res.json({
      success: true,
      contactId: contact.id,
      previousCount: submissionsUsed,
      newCount,
      limit: submissionsLimit,
      remaining: submissionsLimit - newCount,
      adGenerationId
    });
    
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Admin endpoint to check custom fields setup
app.get('/admin/check-fields', async (req, res) => {
  try {
    // Get custom fields for this location
    const fieldsResponse = await axios.get(`https://services.leadconnectorhq.com/locations/${GHL_LOCATION_ID}/customfields`, {
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-04-15'
      }
    });
    
    const fields = fieldsResponse.data.customFields || [];
    
    // Check for our required fields
    const submissionsUsedField = fields.find(f => f.name === 'ads_engine_submissions_used');
    const submissionsLimitField = fields.find(f => f.name === 'ads_engine_submissions_limit');
    
    res.send(`
      <h1>Custom Fields Check</h1>
      
      <div class="card">
        <h3>Required Fields</h3>
        <ul>
          <li>
            ads_engine_submissions_used: 
            ${submissionsUsedField ? 
              `<span class="success">✅ Found</span>` : 
              `<span class="error">❌ Missing</span>`
            }
          </li>
          <li>
            ads_engine_submissions_limit: 
            ${submissionsLimitField ? 
              `<span class="success">✅ Found</span>` : 
              `<span class="error">❌ Missing</span>`
            }
          </li>
        </ul>
        
        ${!submissionsUsedField || !submissionsLimitField ?
          `<div class="alert">
            <p><strong>Action Required:</strong> You need to create the missing custom fields in your GoHighLevel account.</p>
          </div>` :
          `<div class="success-alert">
            <p><strong>Great!</strong> All required custom fields are set up correctly.</p>
          </div>`
        }
      </div>
      
      <div class="card">
        <h3>All Custom Fields</h3>
        <table>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>ID</th>
          </tr>
          ${fields.map(field => `
            <tr>
              <td>${field.name}</td>
              <td>${field.type}</td>
              <td>${field.id}</td>
            </tr>
          `).join('')}
        </table>
      </div>
      
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .card { background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
        .success { color: #10b981; font-weight: bold; }
        .error { color: #ef4444; font-weight: bold; }
        .alert { background: #fef2f2; border-left: 4px solid #ef4444; padding: 10px 15px; border-radius: 4px; }
        .success-alert { background: #ecfdf5; border-left: 4px solid #10b981; padding: 10px 15px; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
      </style>
    `);
    
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).send(`
      <h1>Error</h1>
      <p>Could not check custom fields. Please make sure your API key and location ID are correct.</p>
      <p>Error: ${error.message}</p>
      <pre>${JSON.stringify(error.response?.data || {}, null, 2)}</pre>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
      </style>
    `);
  }
});

// IMPORTANT: Explicitly listen on the port and log that we're running
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
  });
});
