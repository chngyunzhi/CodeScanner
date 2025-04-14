const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const os = require('os');
const localtunnel = require('localtunnel');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

let publicUrl = '';
let tunnel = null;

// Add a global variable to store the processed items
let lastProcessedItems = [];
let lastUploadTimestamp = null;

// Add global variable to track current session folder
let currentSessionFolder = '';

// Function to set up localtunnel with retry mechanism
async function setupTunnel() {
    try {
        if (!tunnel) {
            console.log('Setting up tunnel with subdomain: itemscanner');
            tunnel = await localtunnel({ 
                port: PORT,
                subdomain: 'itemscanner',
                host: 'https://localtunnel.me' // Explicitly set host to ensure consistent subdomain
            });
            
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
        }
        return publicUrl;
    } catch (error) {
        console.error('Error setting up tunnel:', error);
        console.log('Will retry setting up tunnel in 5 seconds...');
        tunnel = null;
        publicUrl = '';
        // Try to reconnect after a short delay
        setTimeout(setupTunnel, 5000);
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
                    // Assuming CSV has same structure: Column C (index 2) - Item Code, D (3) - Part Number, E (4) - Pcs
                    const itemCode = columns[2] ? columns[2].trim() : '';
                    const partNumber = columns[3] ? columns[3].trim() : '';
                    const pc = columns[4] ? columns[4].trim() : '0';
                    
                    // Clean the part number by removing 'P/N' and any surrounding spaces
                    const cleanPartNumber = partNumber.toString().replace(/P\/N\s*:?\s*/i, '').trim();
                    
                    console.log('Processing CSV row:', {
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
                .filter(item => item.itemCode && item.scansRequired > 0); // Only include items with codes and scans required
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
                    const itemCode = row[2] || '';    // Column C - Item Code
                    const partNumber = row[3] || '';  // Column D - Part Number
                    const pc = row[4] || '0';         // Column E - Pcs
                    
                    // Clean the part number by removing 'P/N' and any surrounding spaces
                    const cleanPartNumber = partNumber.toString().replace(/P\/N\s*:?\s*/i, '').trim();
                    
                    console.log('Processing Excel row:', {
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
    if (!publicUrl || !tunnel) {
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
    
    res.json({
        addresses: addresses.filter(addr => 
            !addr.includes('loca.lt') && 
            !addr.includes('localtunnel.me')
        ),
        port: PORT,
        publicUrl: publicUrl
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

// Start the server
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await setupTunnel();
    const addresses = getNetworkAddresses();
    console.log('Local network addresses:', addresses);
}); 