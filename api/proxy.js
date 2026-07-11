module.exports = async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const fetchOptions = {
            method: req.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Content-Type': req.headers['content-type'] || 'application/json'
            }
        };
        
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            fetchOptions.body = typeof req.body === 'object' ? JSON.stringify(req.body) : req.body;
        }
        
        const response = await fetch(url, fetchOptions);
        const text = await response.text();
        res.status(response.status).send(text);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
