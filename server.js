const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const localtunnel = require('localtunnel');
const archiver = require('archiver');

// Try to import ngrok (optional dependency)
let ngrok = null;
try {
    ngrok = require('ngrok');
} catch (error) {
    console.log('ngrok not available, will use localtunnel only');
}

const app = express();
const PORT = process.env.PORT || 3000;

let publicUrl = '';
let tunnel = null;
let ngrokUrl = null;
let tunnelMonitorInterval = null;
let isSettingUpTunnel = false;

function stopTunnelMonitor() {
    if (tunnelMonitorInterval) {
        clearInterval(tunnelMonitorInterval);
        tunnelMonitorInterval = null;
    }
}

async function restartTunnel(reason) {
    try {
        console.log(`Restarting tunnel${reason ? ` (${reason})` : ''}...`);
        stopTunnelMonitor();

        if (tunnel) {
            try {
                tunnel.close();
            } catch (e) {
                // ignore
            }
        }

        tunnel = null;
        publicUrl = '';
        await setupTunnel();
    } catch (error) {
        console.error('Error restarting tunnel:', error);
    }
}

// Add a global variable to store the processed items
let lastProcessedItems = [];
let lastUploadTimestamp = null;

// Add global variable to track current session folder
let currentSessionFolder = '';

// Function to test if a tunnel URL is actually accessible
async function testTunnelUrl(url) {
    try {
        const response = await fetch(`${url}/server-info`);
        return response.ok;
    } catch (error) {
        console.log(`Tunnel test failed for ${url}:`, error.message);
        return false;
    }
}

// Function to set up a simple HTTP tunnel (alternative to localtunnel/ngrok)
async function setupSimpleTunnel() {
    try {
        console.log('Setting up simple HTTP tunnel...');
        
        // For now, just return the local network addresses
        // This provides local network access without external tunneling
        const addresses = getNetworkAddresses();
        const localUrls = addresses.map(addr => `http://${addr}:${PORT}`);
        
        console.log('Local network URLs available:', localUrls);
        
        // Return the first available local URL
        if (localUrls.length > 0) {
            return localUrls[0];
        }
        
        return null;
    } catch (error) {
        console.error('Error setting up simple tunnel:', error);
        return null;
    }
}

// Function to set up ngrok tunnel
async function setupNgrokTunnel() {
    if (!ngrok) {
        console.log('ngrok not available');
        return null;
    }
    
    try {
        console.log('Setting up ngrok tunnel...');
        const url = await ngrok.connect({
            addr: PORT,
            authtoken: process.env.NGROK_AUTH_TOKEN // Optional: set this environment variable for custom domains
        });
        
        ngrokUrl = url;
        console.log('ngrok URL:', ngrokUrl);
        
        // Set up ngrok event handlers
        ngrok.onConnect((url) => {
            console.log('ngrok connected:', url);
        });
        
        ngrok.onDisconnect(() => {
            console.log('ngrok disconnected');
            ngrokUrl = null;
            // Try to reconnect
            setTimeout(setupNgrokTunnel, 5000);
        });
        
        return ngrokUrl;
    } catch (error) {
        console.error('Error setting up ngrok tunnel:', error);
        return null;
    }
}

// Function to set up localtunnel with retry mechanism
async function setupTunnel() {
    try {
        if (isSettingUpTunnel) return publicUrl;
        isSettingUpTunnel = true;

        if (!tunnel) {
            console.log('Setting up tunnel with subdomain: itemscanner');
            
            // Try different tunnel configurations
            const tunnelOptions = [
                { 
                    port: PORT,
                    subdomain: 'itemscanner',
                    host: 'https://localtunnel.me'
                },
                { 
                    port: PORT,
                    subdomain: 'itemscanner',
                    host: 'https://loca.lt'
                },
                { 
                    port: PORT,
                    subdomain: 'itemscanner'
                }
            ];
            
            let tunnelCreated = false;
            
            for (const options of tunnelOptions) {
                try {
                    console.log(`Trying tunnel with options:`, options);
                    tunnel = await localtunnel(options);
                    tunnelCreated = true;
                    break;
                } catch (tunnelError) {
                    console.log(`Tunnel attempt failed with options:`, options, tunnelError.message);
                    continue;
                }
            }
            
            if (!tunnelCreated) {
                throw new Error('All tunnel configurations failed');
            }
            
            publicUrl = tunnel.url;
            console.log('Public URL:', publicUrl);

            tunnel.on('close', async () => {
                console.log('Tunnel closed, attempting to reconnect...');
                tunnel = null;
                publicUrl = '';
                // Try to reconnect after a short delay
                setTimeout(setupTunnel, 5000);
            });
            
            tunnel.on('error', async (err) => {
                console.error('Tunnel error:', err);
                tunnel = null;
                publicUrl = '';
                // Try to reconnect after a short delay
                setTimeout(setupTunnel, 5000);
            });

            // Health monitor / keep-alive:
            // localtunnel can show "503 - Tunnel Unavailable" after some time without emitting close/error.
            stopTunnelMonitor();
            tunnelMonitorInterval = setInterval(async () => {
                if (!publicUrl) return;
                const ok = await testTunnelUrl(publicUrl);
                if (!ok) {
                    await restartTunnel('health check failed (possible 503 / idle drop)');
                }
            }, 2 * 60 * 1000); // every 2 minutes
        }
        return publicUrl;
    } catch (error) {
        console.error('Error setting up localtunnel:', error);
        console.log('Trying ngrok as fallback...');
        
        // Try ngrok as fallback
        const ngrokUrl = await setupNgrokTunnel();
        if (ngrokUrl) {
            publicUrl = ngrokUrl;
            return publicUrl;
        }
        
        console.log('Both localtunnel and ngrok failed. Will retry in 10 seconds...');
        tunnel = null;
        publicUrl = '';
        
        // Try simple tunnel as last resort
        console.log('Trying simple local tunnel as fallback...');
        const simpleUrl = await setupSimpleTunnel();
        if (simpleUrl) {
            publicUrl = simpleUrl;
            console.log('Using simple local tunnel:', simpleUrl);
            return publicUrl;
        }
        
        // Try to reconnect after a longer delay
        setTimeout(setupTunnel, 10000);
        return null;
    } finally {
        isSettingUpTunnel = false;
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

        // Make sure we have a valid session folder
        if (!currentSessionFolder || !fs.existsSync(currentSessionFolder)) {
            // If no session folder exists, create a default one
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            currentSessionFolder = path.join(scansDir, `session_${timestamp}`);
            fs.mkdirSync(currentSessionFolder, { recursive: true });
        }

        // Create a safe filename from the item code
        const safeItemCode = itemCode.replace(/[^a-z0-9]/gi, '_');
        const fileName = `${safeItemCode}.txt`;
        const filePath = path.join(currentSessionFolder, fileName);

        // Check if file exists and read existing content
        let existingSerials = [];
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            existingSerials = content.split('\n').filter(line => line.trim() !== '');
        }

        // Add new serial number
        existingSerials.push(serialNumber);

        // Write all serial numbers back to file
        fs.writeFileSync(filePath, existingSerials.join('\n'));

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

// Add function to create zip file
async function createZipArchive(files, zipPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        output.on('close', () => resolve());
        archive.on('error', err => reject(err));

        archive.pipe(output);

        // Add each file to the archive
        files.forEach(file => {
            archive.file(file, { name: path.basename(file) });
        });

        archive.finalize();
    });
}

// Update download endpoint to handle multiple files
app.get('/download-scans', async (req, res) => {
    try {
        // If no session folder specified, use the current one
        let targetFolder = currentSessionFolder;
        
        // If no current session or the folder doesn't exist, use the most recent session folder
        if (!targetFolder || !fs.existsSync(targetFolder)) {
            const sessionFolders = fs.readdirSync(scansDir)
                .filter(folder => folder.startsWith('session_'))
                .map(folder => path.join(scansDir, folder))
                .filter(folderPath => fs.statSync(folderPath).isDirectory());
                
            if (sessionFolders.length === 0) {
                return res.status(404).send('No scan files found');
            }
            
            // Sort by modification time (newest first)
            sessionFolders.sort((a, b) => {
                return fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime();
            });
            
            targetFolder = sessionFolders[0];
        }
        
        // Get all txt files in the target folder
        const files = fs.readdirSync(targetFolder)
            .filter(file => file.endsWith('.txt'))
            .map(file => path.join(targetFolder, file));

        if (files.length === 0) {
            return res.status(404).send('No scan files found');
        }

        if (files.length === 1) {
            // If only one file, send it directly
            return res.download(files[0]);
        }

        // If multiple files, create a zip archive
        const zipPath = path.join(targetFolder, 'scans.zip');
        await createZipArchive(files, zipPath);

        // Send the zip file
        res.download(zipPath, 'scans.zip', (err) => {
            if (err) {
                console.error('Error sending zip file:', err);
            }
            // Clean up the zip file after sending
            fs.unlink(zipPath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting zip file:', unlinkErr);
            });
        });
    } catch (error) {
        console.error('Error handling download:', error);
        res.status(500).send('Error downloading files');
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
        // Create a new session folder with timestamp and source file info
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const originalFileName = req.file.originalname.replace(/[^a-z0-9]/gi, '_');
        const sessionFolderName = `session_${timestamp}_${originalFileName}`;
        currentSessionFolder = path.join(scansDir, sessionFolderName);
        
        // Create the session folder
        if (!fs.existsSync(currentSessionFolder)) {
            fs.mkdirSync(currentSessionFolder, { recursive: true });
        }
        
        console.log(`Created new session folder: ${currentSessionFolder}`);

        const filePath = path.join(__dirname, 'uploads', req.file.filename);
        console.log('Reading file from:', filePath);
        
        let processedItems = [];
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        
        if (fileExt === '.csv') {
            // Process CSV file
            const csvData = fs.readFileSync(filePath, 'utf8');
            const lines = csvData.split('\n');
            
            // Skip header row
            const dataRows = lines.slice(1);
            
            processedItems = dataRows
                .filter(line => line.trim() !== '')
                .map(line => {
                    const columns = line.split(',');
                    // Company: Column A (index 0)
                    // Item Code: Column C (index 2)
                    // Part Number: Column D (index 3)
                    // Pcs: Column E (index 4)
                    const company = columns[0] ? columns[0].trim() : '';
                    const itemCode = columns[2] ? columns[2].trim() : '';
                    const partNumber = columns[3] ? columns[3].trim() : '';
                    const pc = columns[4] ? columns[4].trim() : '0';
                    
                    const cleanPartNumber = partNumber.toString().replace(/P\/N\s*:?\s*/i, '').trim();
                    
                    return {
                        company: company,
                        itemCode: itemCode,
                        partNumber: cleanPartNumber,
                        scansRequired: parseInt(pc) || 0
                    };
                })
                .filter(item => item.itemCode && item.scansRequired > 0);
        } else {
            // Process Excel file
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
            processedItems = rawData
                .slice(1) // Skip first row
                .filter(row => row[2] && row[2].toString().trim() !== '') // Check if Item Code exists
                .map(row => {
                    // Company: Column A (index 0)
                    // Part Number: Column C (index 2)
                    // Item Code: Column D (index 3)
                    // Pcs: Column E (index 4)
                    const company = row[0] || '';
                    const partNumber = row[2] || '';
                    const itemCode = row[3] || '';
                    const pc = row[4] || '0';
                    
                    const cleanPartNumber = partNumber.toString().replace(/P\/N\s*:?\s*/i, '').trim();
                    
                    return {
                        company: company,
                        itemCode: itemCode,
                        partNumber: cleanPartNumber,
                        scansRequired: parseInt(pc) || 0
                    };
                })
                .filter(item => item.scansRequired > 0);
        }
        
        console.log('Processed items:', processedItems);
        
        if (processedItems.length === 0) {
            console.log('No items found in the file');
            res.status(400).json({ error: 'No valid items found in the file' });
            return;
        }

        // Store the processed items for remote access
        lastProcessedItems = processedItems;
        lastUploadTimestamp = new Date().toISOString();

        // Save a copy of the uploaded file in the session folder for reference
        const sourceFileName = `source_file${fileExt}`;
        const sourceFilePath = path.join(currentSessionFolder, sourceFileName);
        
        // Copy the file to both the session folder and the excel_data folder
        fs.copyFileSync(filePath, sourceFilePath);
        
        // Also save in excel_data for shared functionality
        const excelCopyDir = path.join(__dirname, 'excel_data');
        if (!fs.existsSync(excelCopyDir)) {
            fs.mkdirSync(excelCopyDir);
        }
        
        const newFileName = `latest_data${fileExt}`;
        const newFilePath = path.join(excelCopyDir, newFileName);
        
        fs.copyFileSync(filePath, newFilePath);
        console.log(`File saved as ${newFilePath} and ${sourceFilePath}`);

        res.json({ 
            items: processedItems,
            timestamp: lastUploadTimestamp,
            sessionFolder: sessionFolderName,
            originalFileName: req.file.originalname
        });
        
        // Clean up the uploaded file
        fs.unlink(filePath, (err) => {
            if (err) console.error('Error deleting file:', err);
        });
    } catch (error) {
        console.error('Error processing file:', error);
        res.status(500).json({ error: 'Error processing file' });
    }
});

// Add a new endpoint to get the latest processed items
app.get('/latest-items', (req, res) => {
    if (lastProcessedItems.length === 0) {
        res.status(404).json({ 
            error: 'No Excel file has been uploaded yet',
            hasData: false
        });
    } else {
        res.json({ 
            items: lastProcessedItems,
            timestamp: lastUploadTimestamp,
            hasData: true
        });
    }
});

// Add an endpoint to get the latest Excel file
app.get('/download-excel', (req, res) => {
    try {
        const excelCopyDir = path.join(__dirname, 'excel_data');
        if (!fs.existsSync(excelCopyDir)) {
            return res.status(404).json({ error: 'No Excel file directory found' });
        }

        const files = fs.readdirSync(excelCopyDir);
        if (files.length === 0) {
            return res.status(404).json({ error: 'No Excel files found' });
        }

        // Find the latest Excel file (should be named latest_data.xlsx or similar)
        const excelFile = files.find(file => file.startsWith('latest_data'));
        if (!excelFile) {
            return res.status(404).json({ error: 'Latest Excel file not found' });
        }

        const filePath = path.join(excelCopyDir, excelFile);
        res.download(filePath);
    } catch (error) {
        console.error('Error downloading Excel:', error);
        res.status(500).json({ error: 'Failed to download Excel file' });
    }
});

// Endpoint to save extracted serial numbers
app.post('/save-extracted-serials', express.json(), (req, res) => {
    try {
        const { sessionName, serialNumbersByPart } = req.body;
        if (!sessionName || !serialNumbersByPart || typeof serialNumbersByPart !== 'object') {
            return res.status(400).json({ error: 'Invalid input data' });
        }

        // Create session folder
        const sessionFolder = path.join(scansDir, sessionName);
        if (!fs.existsSync(sessionFolder)) {
            fs.mkdirSync(sessionFolder, { recursive: true });
        }

        // Write one txt file per part number (matches download-session behavior)
        let totalSerials = 0;
        const combinedLines = [];

        Object.entries(serialNumbersByPart).forEach(([partNumberRaw, serialsRaw]) => {
            const partNumber = String(partNumberRaw || '').trim();
            if (!partNumber) return;

            const serials = Array.isArray(serialsRaw) ? serialsRaw : [];
            const cleanedSerials = serials
                .map(s => String(s).trim())
                .filter(s => s.length > 0);

            if (cleanedSerials.length === 0) return;

            totalSerials += cleanedSerials.length;

            // Safe filename from part number
            const safePart = partNumber.replace(/[^a-z0-9]/gi, '_');
            const filePath = path.join(sessionFolder, `${safePart}.txt`);
            fs.writeFileSync(filePath, cleanedSerials.join('\n'), 'utf8');

            // Also build a combined file for convenience
            combinedLines.push(`[${partNumber}]`);
            cleanedSerials.forEach(sn => combinedLines.push(sn));
            combinedLines.push(''); // blank line between parts
        });

        // Always write a combined file too (helps when user wants a single text file)
        const combinedPath = path.join(sessionFolder, 'extracted_serial_numbers.txt');
        fs.writeFileSync(combinedPath, combinedLines.join('\n'), 'utf8');

        if (totalSerials === 0) {
            return res.status(400).json({ error: 'No serial numbers to save' });
        }

        res.json({ success: true, parts: Object.keys(serialNumbersByPart).length, totalSerials });
    } catch (error) {
        console.error('Error saving extracted serial numbers:', error);
        res.status(500).json({ error: 'Failed to save serial numbers: ' + error.message });
    }
});

// Serve static files from the current directory
app.use(express.static(__dirname));

// Route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to get network info with tunnel refresh
app.get('/network-info', async (req, res) => {
    const addresses = getNetworkAddresses();
    
    // If no public URL or tunnel is closed, try to set up a new one
    if (!publicUrl || (!tunnel && !ngrokUrl)) {
        await setupTunnel();
    }
    
    // If tunnel exists but might be stale, check its status
    if (tunnel) {
        try {
            // Attempt to get tunnel URL to verify it's still active
            const tunnelUrl = tunnel.url;
            if (!tunnelUrl) {
                // If no URL, tunnel might be dead, try to reconnect
                await setupTunnel();
            }
        } catch (error) {
            console.error('Error checking tunnel status:', error);
            // If error occurs, tunnel might be dead, try to reconnect
            await setupTunnel();
        }
    }
    
    // Determine which public URL to use
    let activePublicUrl = publicUrl;
    let tunnelType = 'localtunnel';
    
    if (ngrokUrl && !publicUrl) {
        activePublicUrl = ngrokUrl;
        tunnelType = 'ngrok';
    }

    // If we have a public URL, make a quick health check. If it fails, restart tunnel.
    if (activePublicUrl && activePublicUrl.startsWith('http')) {
        const ok = await testTunnelUrl(activePublicUrl);
        if (!ok && tunnelType === 'localtunnel') {
            await restartTunnel('network-info health check failed');
            activePublicUrl = publicUrl;
        }
    }
    
    res.json({
        addresses: addresses.filter(addr => 
            !addr.includes('loca.lt') && 
            !addr.includes('localtunnel.me') &&
            !addr.includes('ngrok.io')
        ),
        port: PORT,
        publicUrl: activePublicUrl,
        tunnelType: tunnelType,
        ngrokUrl: ngrokUrl
    });
});

// Add endpoint to get a list of all sessions
app.get('/sessions', (req, res) => {
    try {
        const sessionFolders = fs.readdirSync(scansDir)
            .filter(folder => folder.startsWith('session_'))
            .map(folder => {
                const folderPath = path.join(scansDir, folder);
                const stats = fs.statSync(folderPath);
                const fileCount = fs.readdirSync(folderPath).filter(file => file.endsWith('.txt')).length;
                
                return {
                    name: folder,
                    date: stats.mtime,
                    fileCount: fileCount
                };
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date));
            
        res.json({ sessions: sessionFolders });
    } catch (error) {
        console.error('Error getting sessions:', error);
        res.status(500).json({ error: 'Failed to get sessions' });
    }
});

// Add endpoint to download a specific session
app.get('/download-session/:sessionName', async (req, res) => {
    try {
        const sessionName = req.params.sessionName;
        // Validate session name to prevent path traversal
        if (!sessionName || !sessionName.startsWith('session_') || sessionName.includes('..')) {
            return res.status(400).send('Invalid session name');
        }
        
        const sessionPath = path.join(scansDir, sessionName);
        
        // Check if the session folder exists
        if (!fs.existsSync(sessionPath) || !fs.statSync(sessionPath).isDirectory()) {
            return res.status(404).send('Session not found');
        }
        
        // Get all txt files in the session folder
        const files = fs.readdirSync(sessionPath)
            .filter(file => file.endsWith('.txt'))
            .map(file => path.join(sessionPath, file));

        if (files.length === 0) {
            return res.status(404).send('No scan files found in this session');
        }

        if (files.length === 1) {
            // If only one file, send it directly
            return res.download(files[0]);
        }

        // If multiple files, create a zip archive
        const zipPath = path.join(sessionPath, `${sessionName}.zip`);
        await createZipArchive(files, zipPath);

        // Send the zip file
        res.download(zipPath, `${sessionName}.zip`, (err) => {
            if (err) {
                console.error('Error sending zip file:', err);
            }
            // Clean up the zip file after sending
            fs.unlink(zipPath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting zip file:', unlinkErr);
            });
        });
    } catch (error) {
        console.error('Error downloading session:', error);
        res.status(500).send('Error downloading session files');
    }
});

app.post('/upload-stock-take', upload.single('file'), (req, res) => {
    try {
        const filePath = path.join(__dirname, 'uploads', req.file.filename);
        let items = [];
        const fileExt = path.extname(req.file.originalname).toLowerCase();

        if (fileExt === '.csv') {
            const csvData = fs.readFileSync(filePath, 'utf8');
            // Handle both Windows (\r\n) and Unix (\n) line endings
            const lines = csvData.split(/\r?\n/).filter(line => line.trim() !== '');
            const dataRows = lines.slice(1); // Skip header

            items = dataRows
                .filter(line => line.trim() !== '')
                .map(line => {
                    // Handle CSV with potential quoted fields
                    const columns = line.split(',').map(col => col.trim().replace(/^"|"$/g, ''));
                    return {
                        partNumber: columns[1] ? columns[1].trim() : '',
                        quantity: parseInt(columns[2] ? columns[2].trim() : '0', 10)
                    };
                })
                .filter(item => item.partNumber && item.quantity > 0);
        } else { // Handle .xlsx, .xls
            const workbook = xlsx.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

            items = jsonData
                .slice(1) // Skip header
                .map(row => ({
                    partNumber: row[1] ? row[1].toString().trim() : '',
                    quantity: parseInt(row[2] ? row[2].toString().trim() : '0', 10)
                }))
                .filter(item => item.partNumber && item.quantity > 0);
        }

        fs.unlinkSync(filePath); // Clean up uploaded file
        res.json({ items });

    } catch (error) {
        console.error('Error processing stock take file:', error);
        res.status(500).json({ error: 'Error processing stock take file' });
    }
});

// Create stock take directory if it doesn't exist
const stockTakeDir = path.join(__dirname, 'stock_take');
if (!fs.existsSync(stockTakeDir)) {
    fs.mkdirSync(stockTakeDir, { recursive: true });
}

// Endpoint to save stock take progress
app.post('/save-stock-take', express.json(), (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items)) {
            res.status(400).json({ error: 'Invalid items data' });
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `stock_take_${timestamp}.txt`;
        const filePath = path.join(stockTakeDir, fileName);

        // Format: partNumber,quantity,scanned (one per line)
        const content = items.map(item => 
            `${item.partNumber},${item.quantity},${item.scanned || 0}`
        ).join('\n');

        fs.writeFileSync(filePath, content, 'utf8');
        res.json({ success: true, fileName: fileName });
    } catch (error) {
        console.error('Error saving stock take:', error);
        res.status(500).json({ error: 'Failed to save stock take progress' });
    }
});

// Endpoint to load stock take progress
app.get('/load-stock-take', (req, res) => {
    try {
        const files = fs.readdirSync(stockTakeDir)
            .filter(file => file.endsWith('.txt'))
            .map(file => {
                const filePath = path.join(stockTakeDir, file);
                const stats = fs.statSync(filePath);
                return {
                    fileName: file,
                    date: stats.mtime
                };
            })
            .sort((a, b) => b.date - a.date); // Most recent first

        res.json({ files });
    } catch (error) {
        console.error('Error loading stock take files:', error);
        res.status(500).json({ error: 'Failed to load stock take files' });
    }
});

// Endpoint to get specific stock take file content
app.get('/get-stock-take/:fileName', (req, res) => {
    try {
        const fileName = req.params.fileName;
        const filePath = path.join(stockTakeDir, fileName);

        if (!fs.existsSync(filePath)) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
        
        const items = lines.map(line => {
            const [partNumber, quantity, scanned] = line.split(',');
            return {
                partNumber: partNumber ? partNumber.trim() : '',
                quantity: parseInt(quantity ? quantity.trim() : '0', 10),
                scanned: parseInt(scanned ? scanned.trim() : '0', 10)
            };
        }).filter(item => item.partNumber && item.quantity > 0);

        res.json({ items });
    } catch (error) {
        console.error('Error reading stock take file:', error);
        res.status(500).json({ error: 'Failed to read stock take file' });
    }
});

// Start the server
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await setupTunnel();
    const addresses = getNetworkAddresses();
    console.log('Local network addresses:', addresses);
}); 