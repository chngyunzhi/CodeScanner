const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const localtunnel = require('localtunnel');

const app = express();
const PORT = process.env.PORT || 3000;

let publicUrl = '';
let tunnel = null;

// Function to set up localtunnel
async function setupTunnel() {
    try {
        if (!tunnel) {
            tunnel = await localtunnel({ 
                port: PORT,
                // Using a subdomain for consistent URL
                subdomain: 'itemscanner'
            });
            publicUrl = tunnel.url;
            console.log('Public URL:', publicUrl);

            tunnel.on('close', () => {
                console.log('Tunnel closed');
                tunnel = null;
                publicUrl = '';
            });
            
            tunnel.on('error', err => {
                console.error('Tunnel error:', err);
                tunnel = null;
                publicUrl = '';
            });
        }
        return publicUrl;
    } catch (error) {
        console.error('Error setting up tunnel:', error);
        tunnel = null;
        publicUrl = '';
        return null;
    }
}

// Set up the tunnel when server starts
setupTunnel();

// Function to get all network interfaces
function getNetworkAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    // Add local network addresses
    for (const iface of Object.values(interfaces)) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                addresses.push(addr.address);
            }
        }
    }

    return addresses;
}

// Endpoint to get server addresses
app.get('/server-info', (req, res) => {
    const addresses = getNetworkAddresses();
    res.json({
        port: PORT,
        addresses: addresses,
        publicUrl: publicUrl
    });
});

// Create scans directory if it doesn't exist
const scansDir = path.join(__dirname, 'scans');
if (!fs.existsSync(scansDir)) {
    fs.mkdirSync(scansDir);
}

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Set up storage for Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// Endpoint to save scan
app.post('/save-scan', express.json(), (req, res) => {
    try {
        const { itemCode, serialNumber } = req.body;
        if (!itemCode || !serialNumber) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Create a safe filename from the item code
        const safeItemCode = itemCode.replace(/[^a-z0-9]/gi, '_');
        const fileName = `${safeItemCode}.txt`;
        const filePath = path.join(scansDir, fileName);

        // Check if file exists
        const fileExists = fs.existsSync(filePath);
        
        // Add a newline before the serial number only if file exists and has content
        const prefix = fileExists && fs.statSync(filePath).size > 0 ? '\n' : '';
        
        // Append serial number to file
        fs.appendFileSync(filePath, `${prefix}${serialNumber}`);

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving scan:', error);
        res.status(500).json({ error: 'Failed to save scan' });
    }
});

// Function to get the latest scan file
function getLatestScanFile() {
    const files = fs.readdirSync(scansDir);
    if (files.length === 0) return null;
    
    return files.reduce((latest, file) => {
        const filePath = path.join(scansDir, file);
        const stats = fs.statSync(filePath);
        if (!latest || stats.mtime > latest.mtime) {
            return { file, mtime: stats.mtime };
        }
        return latest;
    }, null);
}

// Endpoint to download latest scan file
app.get('/download-scans', (req, res) => {
    try {
        const latestFile = getLatestScanFile();
        if (!latestFile) {
            res.status(404).json({ error: 'No scan files found' });
            return;
        }

        const filePath = path.join(scansDir, latestFile.file);
        res.download(filePath);
    } catch (error) {
        console.error('Error downloading file:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Endpoint to check if user is on mobile
app.get('/check-mobile', (req, res) => {
    const userAgent = req.headers['user-agent'];
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    res.json({ isMobile });
});

// Endpoint to open scans folder
app.get('/open-folder', (req, res) => {
    const command = process.platform === 'win32' ? 
        `explorer "${scansDir}"` : 
        process.platform === 'darwin' ? 
        `open "${scansDir}"` : 
        `xdg-open "${scansDir}"`;

    exec(command, (error) => {
        if (error) {
            console.error('Error opening folder:', error);
            res.status(500).json({ error: 'Failed to open folder' });
            return;
        }
        res.json({ success: true });
    });
});

// Endpoint to handle file upload
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        const filePath = path.join(__dirname, 'uploads', req.file.filename);
        console.log('Reading file from:', filePath);
        
        const workbook = xlsx.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        console.log('Sheet name:', sheetName);
        
        const sheet = workbook.Sheets[sheetName];
        
        // Convert the sheet data to rows with all formatting preserved
        const rawData = xlsx.utils.sheet_to_json(sheet, {
            header: 1,  // Get array of arrays
            raw: false, // Keep formatting
            defval: ''  // Empty cells as empty string
        });
        
        console.log('First few rows of raw data:', rawData.slice(0, 3));
        
        // Start from second row (index 1) and process the data
        // Column C (index 2) - Item Code
        // Column D (index 3) - Part Number
        // Column E (index 4) - Pcs
        const processedItems = rawData
            .slice(1) // Skip first row
            .filter(row => row[2] && row[2].toString().trim() !== '') // Check if Item Code exists
            .map(row => {
                const itemCode = row[2] || '';    // Column C - Item Code
                const partNumber = row[3] || '';  // Column D - Part Number
                const pc = row[4] || '0';         // Column E - Pcs
                
                // Clean the part number by removing 'P/N' and any surrounding spaces
                const cleanPartNumber = partNumber.toString().replace(/P\/N\s*:?\s*/i, '').trim();
                
                console.log('Processing row:', {
                    itemCode: itemCode,
                    partNumber: partNumber,
                    cleanPartNumber: cleanPartNumber,
                    pc: pc
                });

                return {
                    itemCode: itemCode,
                    partNumber: cleanPartNumber,
                    scansRequired: parseInt(pc) || 0
                };
            })
            .filter(item => item.scansRequired > 0); // Only include items with scans required

        console.log('Processed items:', processedItems);
        
        if (processedItems.length === 0) {
            console.log('No items found in the file');
            res.status(400).json({ error: 'No valid items found in the file' });
            return;
        }

        res.json({ items: processedItems });
        
        // Clean up the uploaded file
        fs.unlink(filePath, (err) => {
            if (err) console.error('Error deleting file:', err);
        });
    } catch (error) {
        console.error('Error processing file:', error);
        res.status(500).json({ error: 'Error processing file' });
    }
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to get network info
app.get('/network-info', async (req, res) => {
    const addresses = getNetworkAddresses();
    
    // Ensure we have a public URL
    if (!publicUrl) {
        await setupTunnel();
    }
    
    res.json({
        addresses: addresses.filter(addr => 
            !addr.includes('loca.lt') && 
            !addr.includes('localtunnel.me')
        ),
        port: PORT,
        publicUrl: publicUrl
    });
});

// Start the server
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await setupTunnel();
    const addresses = getNetworkAddresses();
    console.log('Local network addresses:', addresses);
}); 