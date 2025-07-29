let currentPartNumber = '';
let scansRemaining = 0;
let allItems = [];
let currentItemIndex = 0;
let isMobileDevice = false;

// Add error sound
const errorSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

// Add success sound
const successSound = new Audio('https://assets.mixkit.co/active_storage/sfx/4227/4227-preview.mp3');

// Add variable to track modal state
let isNetworkModalOpen = false;
let networkRefreshInterval = null;

// Add scanner variables
let html5QrcodeScanner = null;
let isScannerActive = false;

// Add variable to track current session
let currentSession = '';

// Add a new array to store scan progress for each item
let itemsProgress = [];

// Add variables for serial number extractor
// let extractedSerialNumbers = [];
// let extractorScannerInstance = null;

// Refactored: Store serials by part number
let extractedSerialsByPart = {}; // { partNumber: [serialNumbers] }
let extractorScannerInstance = null;

// Add a new object to track counts for part numbers without serials
let extractedNoSerialCount = {}; // { partNumber: count }

// Add variables for stock take mode
let stockTakeItems = [];
let stockTakeScannedCounts = {};

// Check if user is on mobile device
fetch('/check-mobile')
    .then(response => response.json())
    .then(data => {
        isMobileDevice = data.isMobile;
        updateFolderButton();
    })
    .catch(error => console.error('Error checking device type:', error));

document.addEventListener('DOMContentLoaded', function() {
    // Add event listener for file input
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    
    // Add event listeners for network info and folder buttons
    document.getElementById('showNetworkBtn').addEventListener('click', showNetworkInfo);
    document.querySelector('.close').addEventListener('click', hideNetworkInfo);
    document.getElementById('networkModal').addEventListener('click', function(event) {
        if (event.target === this) {
            hideNetworkInfo();
        }
    });
    
    document.getElementById('openFolderBtn').addEventListener('click', handleFolderClick);
    
    // Add event listener for scan input
    const scanInput = document.getElementById('scanInput');
    scanInput.addEventListener('keydown', handleScan);
    
    // Add event listeners for navigation buttons
    document.getElementById('backButton').addEventListener('click', handleBack);
    document.getElementById('skipButton').addEventListener('click', handleSkip);
    
    // Add scanner initialization
    document.getElementById('toggleScannerBtn').addEventListener('click', toggleScanner);
    
    // Add drag and drop for file upload
    const uploadSection = document.querySelector('.upload-section');
    uploadSection.addEventListener('click', () => document.getElementById('fileInput').click());
    uploadSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadSection.classList.add('drag-over');
    });
    uploadSection.addEventListener('dragleave', () => {
        uploadSection.classList.remove('drag-over');
    });
    uploadSection.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadSection.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) {
            const fileInput = document.getElementById('fileInput');
            fileInput.files = e.dataTransfer.files;
            handleFileUpload({ target: fileInput });
        }
    });
    
    // Check if user is on mobile and if there's already an Excel file
    checkMobileAndExcelStatus();

    // Auto-focus the scan input
    scanInput.focus();

    // Add event listeners for extractor mode
    document.getElementById('extractModeBtn').addEventListener('click', toggleExtractorMode);
    document.getElementById('backToMainBtn').addEventListener('click', toggleExtractorMode);
    document.getElementById('extractorInput').addEventListener('keydown', handleExtractorScan);
    document.getElementById('extractorScannerBtn').addEventListener('click', toggleExtractorScanner);
    document.getElementById('exportBtn').addEventListener('click', exportSerialNumbers);

    // Add event listeners for stock take mode
    document.getElementById('stockTakeBtn').addEventListener('click', toggleStockTakeMode);
    document.getElementById('backToMainFromStockTakeBtn').addEventListener('click', toggleStockTakeMode);
    document.getElementById('stockTakeFileInput').addEventListener('change', handleStockTakeUpload);
    document.getElementById('stockTakeScanInput').addEventListener('keydown', handleStockTakeScan);
    document.getElementById('stockTakeScannerBtn').addEventListener('click', toggleStockTakeScanner);
    
    // Add drag and drop for stock take file upload
    const stockTakeUploadSection = document.getElementById('stockTakeUploadSection');
    stockTakeUploadSection.addEventListener('click', () => document.getElementById('stockTakeFileInput').click());
    stockTakeUploadSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        stockTakeUploadSection.classList.add('drag-over');
    });
    stockTakeUploadSection.addEventListener('dragleave', () => {
        stockTakeUploadSection.classList.remove('drag-over');
    });
    stockTakeUploadSection.addEventListener('drop', (e) => {
        e.preventDefault();
        stockTakeUploadSection.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) {
            const fileInput = document.getElementById('stockTakeFileInput');
            fileInput.files = e.dataTransfer.files;
            handleStockTakeUpload({ target: fileInput });
        }
    });
});

// Function to check if user is on mobile and check for existing Excel
async function checkMobileAndExcelStatus() {
    try {
        // Check if user is on mobile
        const mobileResponse = await fetch('/check-mobile');
        const mobileData = await mobileResponse.json();
        
        if (mobileData.isMobile) {
            // If on mobile, check for latest items
            checkForLatestItems();
        }
    } catch (error) {
        console.error('Error checking device type:', error);
    }
}

// Function to check for latest items from server
async function checkForLatestItems() {
    try {
        const response = await fetch('/latest-items');
        const data = await response.json();
        
        if (data.hasData) {
            // Show notification that Excel data is available
            const uploadSection = document.querySelector('.upload-section');
            uploadSection.innerHTML = `
                <p>Excel data available! Uploaded: ${new Date(data.timestamp).toLocaleString()}</p>
                <button id="useSharedExcel" class="action-button">Use Shared Data</button>
                <button id="downloadExcel" class="action-button secondary">Download Excel</button>
            `;
            
            // Add event listeners for the new buttons
            document.getElementById('useSharedExcel').addEventListener('click', useSharedExcelData);
            document.getElementById('downloadExcel').addEventListener('click', downloadExcelFile);
        }
    } catch (error) {
        console.error('Error checking for latest items:', error);
    }
}

// Function to use shared Excel data
async function useSharedExcelData() {
    try {
        const response = await fetch('/latest-items');
        const data = await response.json();
        
        if (data.hasData) {
            // Use the items directly
            allItems = data.items;
            currentItemIndex = 0;
            
            // Initialize progress tracking for all items
            itemsProgress = allItems.map(item => ({
                scansRemaining: item.scansRequired,
                serialNumbers: []
            }));
            
            // Display the first item
            displayCurrentItem();
            
            // Update the upload section
            const uploadSection = document.querySelector('.upload-section');
            uploadSection.innerHTML = `
                <div class="current-session-info">
                    <p><strong>Active File:</strong> ${data.originalFileName}</p>
                    <p><strong>Session:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
                    <p><strong>Items:</strong> ${allItems.length}</p>
                </div>
                <button id="uploadAnotherBtn" class="action-button">Upload Another File</button>
                <button id="viewSessions" class="action-button secondary">View Previous Sessions</button>
                <div id="uploadedItemsTableContainer"></div>
            `;
            document.getElementById('uploadAnotherBtn').addEventListener('click', function() {
                document.getElementById('fileInput').click();
            });
            document.getElementById('viewSessions').addEventListener('click', showSessionsModal);
            renderUploadedItemsTable(allItems);
            
            console.log('Shared data loaded successfully. Items:', allItems);
        }
    } catch (error) {
        console.error('Error using shared Excel data:', error);
        alert('Error loading shared Excel data. Please try again.');
    }
}

// Function to download the Excel file
function downloadExcelFile() {
    window.location.href = '/download-excel';
}

function updateFolderButton() {
    const folderBtn = document.getElementById('openFolderBtn');
    if (isMobileDevice) {
        folderBtn.innerHTML = '<i class="fas fa-download"></i>';
        folderBtn.title = 'Download Scans';
    } else {
        folderBtn.innerHTML = '<i class="fas fa-folder-open"></i>';
        folderBtn.title = 'Open Scans Folder';
    }
}

async function handleFolderClick() {
    try {
        if (isMobileDevice) {
            // For mobile: download the file
            window.location.href = '/download-scans';
        } else {
            // For desktop: open the folder
            const response = await fetch('/open-folder');
            if (!response.ok) {
                throw new Error('Failed to open folder');
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
        const formData = new FormData();
        formData.append('file', file);

        // Show loading state
        document.getElementById('itemCode').textContent = 'Loading...';
        document.getElementById('company').textContent = 'Loading...';
        document.getElementById('partNumber').textContent = 'Loading...';
        document.getElementById('scansLeft').textContent = 'Loading...';

        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.items && data.items.length > 0) {
                allItems = data.items;
                currentItemIndex = 0;
                // Initialize progress tracking for all items
                itemsProgress = allItems.map(item => ({
                    scansRemaining: item.scansRequired,
                    serialNumbers: []
                }));
                // Track the current session folder
                currentSession = data.sessionFolder;
                displayCurrentItem();
                document.getElementById('scanInput').focus();
                
                // Update the upload section to show current session info
                const uploadSection = document.querySelector('.upload-section');
                uploadSection.innerHTML = `
                    <div class="current-session-info">
                        <p><strong>Active File:</strong> ${data.originalFileName}</p>
                        <p><strong>Session:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
                        <p><strong>Items:</strong> ${allItems.length}</p>
                    </div>
                    <button id="uploadAnotherBtn" class="action-button">Upload Another File</button>
                    <button id="viewSessions" class="action-button secondary">View Previous Sessions</button>
                    <div id="uploadedItemsTableContainer"></div>
                `;
                document.getElementById('uploadAnotherBtn').addEventListener('click', function() {
                    document.getElementById('fileInput').click();
                });
                document.getElementById('viewSessions').addEventListener('click', showSessionsModal);
                renderUploadedItemsTable(allItems);
            } else {
                alert('No items found in the Excel file');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            highlightError(document.getElementById('scanInput'));
            playErrorSound();
        });
    }
}

function displayCurrentItem() {
    if (allItems.length === 0) return;
    
    const currentItem = allItems[currentItemIndex];
    document.getElementById('itemCode').textContent = currentItem.itemCode || 'N/A';
    document.getElementById('company').textContent = currentItem.company || 'N/A';
    document.getElementById('partNumber').textContent = currentItem.partNumber || 'N/A';
    document.getElementById('scansLeft').textContent = itemsProgress[currentItemIndex].scansRemaining || '0';
    currentPartNumber = currentItem.partNumber;
    scansRemaining = itemsProgress[currentItemIndex].scansRemaining;

    // Clear and focus the scan input field
    const scanInput = document.getElementById('scanInput');
    scanInput.value = '';
    scanInput.disabled = false;  // Make sure input is enabled
    scanInput.focus();

    // Add visual feedback for current item
    const itemInfo = document.getElementById('itemInfo');
    itemInfo.style.backgroundColor = '#e8f5e9';  // Light green background
    setTimeout(() => {
        itemInfo.style.backgroundColor = '#f8f9fa';  // Return to original color
    }, 500);

    // Update navigation buttons
    document.getElementById('backButton').disabled = currentItemIndex === 0;
    document.getElementById('skipButton').disabled = currentItemIndex === allItems.length - 1;
}

function extractPartNumber(input) {
    // Case 1: pid.sick.com/1138661/23400015 (29 characters)
    if (input.length === 29 && input.includes('pid.sick.com/')) {
        return input.split('/')[1];
    }
    // Case 2: pid.sick.com/1234567 (20 characters)
    else if (input.length === 20 && input.includes('pid.sick.com/')) {
        return input.split('/')[1];
    }
    // Case 3: http://pid.sick.com/1234567 (27 characters - last 7 digits are part number)
    else if (input.length === 27 && input.includes('http://pid.sick.com/')) {
        return input.split('/')[3];
    }
    // Case 4: 104631522440725 (15 characters - first 7 digits)
    else if (input.length === 15) {
        return input.substring(0, 7);
    }
    // Case 5: 1234567 (7 characters)
    else if (input.length === 7) {
        return input;
    }
    // Case 6: 12345672022 (11 characters - first 7 digits are part number)
    else if (input.length === 11) {
        return input.substring(0, 7);
    }
    // Case 7: 12345672022X (12 characters - first 7 digits are part number)
    else if (input.length === 12) {
        return input.substring(0, 7);      
    }
    return null;
}

function extractSerialNumber(input) {
    // Case 1: pid.sick.com/1138661/23400015 -> extract 23400015
    if (input.length === 29 && input.includes('pid.sick.com/')) {
        return input.split('/')[2];
    }
    // Case 2: pid.sick.com/1234567 -> extract 1234567
    else if (input.length === 20 && input.includes('pid.sick.com/')) {
        return input.split('/')[1];
    }
    // Case 3: http://pid.sick.com/1234567 -> extract 1234567
    else if (input.length === 27 && input.includes('http://pid.sick.com/')) {
        return input.split('/')[3];
    }
    // Case 4: 104631522440725 -> extract last 8 digits (22440725)
    else if (input.length === 15) {
        return input.slice(-8);
    }
    // Case 5: 1234567 -> return as is
    else if (input.length === 7) {
        return input;
    }
    // Case 6: 12345672022 -> return full number
    else if (input.length === 11) {
        return input;
    }
    // Case 7: 12345672022X -> return full number
    else if (input.length === 12) {
        return input;
    }

    return null;
}

function handleScan(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const scanInput = event.target;
        const userInput = scanInput.value.trim();
        
        // Extract part number for validation
        const scannedPartNumber = extractPartNumber(userInput);
        // Extract serial number for saving
        const serialNumber = extractSerialNumber(userInput);
        
        if (!scannedPartNumber || !serialNumber) {
            highlightError(scanInput);
            playErrorSound();
            scanInput.value = '';
            scanInput.focus();  // Keep focus on input
            return;
        }

        // Compare with current item's part number
        if (scannedPartNumber === currentPartNumber) {
            if (scansRemaining > 0) {
                // Save only the serial number
                saveScan(serialNumber);
                
                // Store the serial number in our progress tracking
                itemsProgress[currentItemIndex].serialNumbers.push(serialNumber);
                
                scansRemaining--;
                // Update the progress tracking
                itemsProgress[currentItemIndex].scansRemaining = scansRemaining;
                document.getElementById('scansLeft').textContent = scansRemaining;
                
                if (scansRemaining === 0) {
                    if (currentItemIndex < allItems.length - 1) {
                        currentItemIndex++;
                        displayCurrentItem();
                    } else {
                        alert('All items have been scanned!');
                        scanInput.focus();  // Keep focus on input
                    }
                } else {
                    scanInput.value = '';
                    scanInput.focus();  // Keep focus on input
                }
            }
        } else {
            highlightError(scanInput);
            playErrorSound();
            scanInput.value = '';
            scanInput.focus();  // Keep focus on input
        }
    }
}

async function saveScan(serialNumber) {
    try {
        const currentItem = allItems[currentItemIndex];
        const response = await fetch('/save-scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                itemCode: currentItem.itemCode,
                serialNumber: serialNumber
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save scan');
        }
    } catch (error) {
        console.error('Error saving scan:', error);
    }
}

function highlightError(element) {
    element.classList.add('error');
    setTimeout(() => {
        element.classList.remove('error');
    }, 1000);
}

function playErrorSound() {
    errorSound.currentTime = 0;
    errorSound.play().catch(error => console.log('Error playing sound:', error));
}

function handleSkip() {
    if (currentItemIndex < allItems.length - 1) {
        currentItemIndex++;
        displayCurrentItem();
    }
}

function handleBack() {
    if (currentItemIndex > 0) {
        currentItemIndex--;
        displayCurrentItem();
    }
}

// Function to show network information
function showNetworkInfo() {
    isNetworkModalOpen = true;
    const modal = document.getElementById('networkModal');
    modal.style.display = 'block';
    
    // Initial fetch
    fetchAndUpdateNetworkInfo();
    
    // Set up periodic refresh while modal is open
    networkRefreshInterval = setInterval(fetchAndUpdateNetworkInfo, 10000); // Refresh every 10 seconds
}

function hideNetworkInfo() {
    isNetworkModalOpen = false;
    const modal = document.getElementById('networkModal');
    modal.style.display = 'none';
    
    // Clear refresh interval
    if (networkRefreshInterval) {
        clearInterval(networkRefreshInterval);
        networkRefreshInterval = null;
    }
    
    // Stop scanner if active
    stopScanner();
    
    // Restore focus to scan input
    document.getElementById('scanInput').focus();
}

function fetchAndUpdateNetworkInfo() {
    if (!isNetworkModalOpen) return;

    fetch('/network-info')
        .then(response => response.json())
        .then(data => {
            const qrCodeDiv = document.getElementById('qrCode');
            const addressList = document.getElementById('addressList');
            
            // Clear previous content
            qrCodeDiv.innerHTML = '';
            addressList.innerHTML = '';
            
            // Handle public URL - ensure we're using itemscanner.loca.lt
            let publicUrl = data.publicUrl;
            
            // Check if we have a public URL
            if (publicUrl) {
                console.log('Public URL received:', publicUrl);
                
                // Generate QR code
                new QRCode(qrCodeDiv, {
                    text: publicUrl,
                    width: 200,
                    height: 200,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });

                // Display public URL with clear label
                const publicUrlItem = document.createElement('div');
                publicUrlItem.className = 'public-url';
                publicUrlItem.innerHTML = `
                    <strong>Public URL (Scan QR code or click):</strong><br>
                    <a href="${publicUrl}" target="_blank">${publicUrl}</a>
                `;
                addressList.appendChild(publicUrlItem);
            } else {
                const errorMsg = document.createElement('div');
                errorMsg.className = 'error-message';
                errorMsg.textContent = 'Connecting to public URL... Please wait.';
                addressList.appendChild(errorMsg);
                
                // If no public URL is available, try again in 3 seconds
                setTimeout(fetchAndUpdateNetworkInfo, 3000);
            }

            // Display local network addresses
            if (data.addresses.length > 0) {
                const header = document.createElement('div');
                header.className = 'address-header';
                header.textContent = 'Local Network Access:';
                addressList.appendChild(header);

                data.addresses.forEach(address => {
                    const li = document.createElement('li');
                    const localUrl = `http://${address}:${data.port}`;
                    li.innerHTML = `<a href="${localUrl}" target="_blank">${localUrl}</a>`;
                    addressList.appendChild(li);
                });
            }
            
            // Add note about connections at the bottom
            const note = document.createElement('div');
            note.className = 'connection-note';
            note.innerHTML = `
                <p>
                    <strong>Note:</strong> The public URL (itemscanner.loca.lt) 
                    can be accessed from any network. Local addresses only work when 
                    connected to the same network as the server.
                </p>
            `;
            addressList.appendChild(note);
        })
        .catch(error => {
            console.error('Error fetching network info:', error);
            if (isNetworkModalOpen) {
                const addressList = document.getElementById('addressList');
                addressList.innerHTML = '<div class="error-message">Error connecting to server. Retrying...</div>';
                setTimeout(fetchAndUpdateNetworkInfo, 3000);
            }
        });
}

function toggleScanner() {
    const readerDiv = document.getElementById('reader');
    const toggleButton = document.getElementById('toggleScannerBtn');

    if (!isScannerActive) {
        // Start scanner
        readerDiv.style.display = 'block';
        toggleButton.classList.add('active');
        
        html5QrcodeScanner = new Html5Qrcode("reader");
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
        };

        html5QrcodeScanner.start(
            { facingMode: "environment" },
            config,
            onScanSuccess,
            onScanError
        )
        .then(() => {
            isScannerActive = true;
            console.log("Scanner started successfully");
        })
        .catch((err) => {
            console.error("Error starting scanner:", err);
            alert("Could not start camera scanner. Please check camera permissions.");
            stopScanner();
        });
    } else {
        stopScanner();
    }
}

function stopScanner() {
    if (html5QrcodeScanner && isScannerActive) {
        html5QrcodeScanner.stop()
            .then(() => {
                console.log('Scanner stopped');
                document.getElementById('reader').style.display = 'none';
                document.getElementById('toggleScannerBtn').classList.remove('active');
                isScannerActive = false;
                html5QrcodeScanner = null;
            })
            .catch((err) => {
                console.error('Error stopping scanner:', err);
            });
    }
}

function onScanSuccess(decodedText, decodedResult) {
    // Stop scanning after successful scan
    stopScanner();
    
    // Set the scanned value to the input
    const scanInput = document.getElementById('scanInput');
    scanInput.value = decodedText;
    
    // Trigger the scan handling
    scanInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
    }));
}

function onScanError(error) {
    // Handle scan error silently
    console.warn(`Code scan error = ${error}`);
}

// Add a function to show sessions modal
function showSessionsModal() {
    // Create modal if it doesn't exist
    let sessionsModal = document.getElementById('sessionsModal');
    if (!sessionsModal) {
        sessionsModal = document.createElement('div');
        sessionsModal.id = 'sessionsModal';
        sessionsModal.className = 'modal';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        
        const closeSpan = document.createElement('span');
        closeSpan.className = 'close';
        closeSpan.innerHTML = '&times;';
        closeSpan.onclick = hideSessionsModal;
        
        const modalTitle = document.createElement('h2');
        modalTitle.textContent = 'Previous Sessions';
        
        const sessionsList = document.createElement('div');
        sessionsList.id = 'sessionsList';
        
        modalContent.appendChild(closeSpan);
        modalContent.appendChild(modalTitle);
        modalContent.appendChild(sessionsList);
        sessionsModal.appendChild(modalContent);
        
        // Add click handler to close modal when clicking outside
        sessionsModal.onclick = function(event) {
            if (event.target === this) {
                hideSessionsModal();
            }
        };
        
        document.body.appendChild(sessionsModal);
    }
    
    // Fetch and display sessions
    fetchSessions();
    
    // Show the modal
    sessionsModal.style.display = 'block';
}

// Function to hide sessions modal
function hideSessionsModal() {
    const modal = document.getElementById('sessionsModal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Restore focus to scan input
    document.getElementById('scanInput').focus();
}

// Function to fetch sessions
function fetchSessions() {
    fetch('/sessions')
        .then(response => response.json())
        .then(data => {
            const sessionsList = document.getElementById('sessionsList');
            sessionsList.innerHTML = '';
            
            if (data.sessions.length === 0) {
                sessionsList.innerHTML = '<p>No previous sessions found</p>';
                return;
            }
            
            // Create a list of sessions
            data.sessions.forEach(session => {
                const sessionItem = document.createElement('div');
                sessionItem.className = 'session-item';
                
                const date = new Date(session.date).toLocaleString();
                
                // Extract file name from session name if possible
                let displayName = "Session";
                const sessionNameParts = session.name.split('_');
                if (sessionNameParts.length > 2) {
                    // Try to get original file name (everything after timestamp)
                    const fileNameParts = sessionNameParts.slice(2).join('_');
                    if (fileNameParts) {
                        displayName = fileNameParts.replace(/_/g, ' ');
                    }
                }
                
                sessionItem.innerHTML = `
                    <div class="session-info">
                        <strong>${displayName}</strong>
                        <span>${date}</span>
                        <span>${session.fileCount} item${session.fileCount !== 1 ? 's' : ''} scanned</span>
                    </div>
                    <div class="session-actions">
                        <button class="action-button small" data-session="${session.name}" data-action="download">
                            <i class="fas fa-download"></i> Download
                        </button>
                    </div>
                `;
                
                sessionsList.appendChild(sessionItem);
                
                // Add event listener for download button
                const downloadBtn = sessionItem.querySelector('[data-action="download"]');
                downloadBtn.addEventListener('click', function() {
                    const sessionName = this.getAttribute('data-session');
                    downloadSession(sessionName);
                });
            });
        })
        .catch(error => {
            console.error('Error fetching sessions:', error);
            const sessionsList = document.getElementById('sessionsList');
            sessionsList.innerHTML = '<p>Error loading sessions</p>';
        });
}

// Function to download a specific session
function downloadSession(sessionName) {
    window.location.href = `/download-session/${sessionName}`;
}

// Function to toggle between main scanner and extractor mode
function toggleExtractorMode() {
    const mainContainer = document.getElementById('mainContainer');
    const extractorContainer = document.getElementById('extractorContainer');
    
    if (mainContainer.style.display !== 'none') {
        // Switch to extractor mode
        mainContainer.style.display = 'none';
        extractorContainer.style.display = 'block';
        document.getElementById('extractorInput').focus();
        // Reset extractor state
        extractedSerialsByPart = {};
        extractedNoSerialCount = {};
        updateSerialNumbersList();
        document.getElementById('outputFileName').value = `serial_numbers_${new Date().toISOString().split('T')[0]}`;
    } else {
        // Switch back to main mode
        mainContainer.style.display = 'block';
        extractorContainer.style.display = 'none';
        // Stop extractor scanner if active
        stopExtractorScanner();
        document.getElementById('scanInput').focus();
    }
}

// Function to handle scans in extractor mode
function handleExtractorScan(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const input = event.target;
        const scannedValue = input.value.trim();
        
        // Check if the scanned data contains a serial number
        const hasSerialNumber = hasSeparateSerialNumber(scannedValue);
        
        if (hasSerialNumber) {
            // Extract both part number and serial number
            const partNumber = extractPartNumber(scannedValue);
            const serialNumber = extractSerialNumber(scannedValue);
            
            if (partNumber && serialNumber) {
                if (!extractedSerialsByPart[partNumber]) {
                    extractedSerialsByPart[partNumber] = [];
                }
                // Add to list if not duplicate
                if (!extractedSerialsByPart[partNumber].includes(serialNumber)) {
                    extractedSerialsByPart[partNumber].push(serialNumber);
                    updateSerialNumbersList();
                }
            } else {
                highlightError(input);
                playErrorSound();
            }
        } else {
            // No serial number in scanned data, but still extract part number for display
            const partNumber = extractPartNumber(scannedValue);
            if (partNumber) {
                if (!extractedNoSerialCount[partNumber]) {
                    extractedNoSerialCount[partNumber] = 0;
                }
                extractedNoSerialCount[partNumber]++;
                updateSerialNumbersList();
            } else {
                highlightError(input);
                playErrorSound();
            }
        }
        
        input.value = '';
        input.focus();
    }
}

// Function to determine if scanned data contains a separate serial number
function hasSeparateSerialNumber(input) {
    // Case 1: pid.sick.com/1138661/23400015 (29 characters) - has separate serial
    if (input.length === 29 && input.includes('pid.sick.com/')) {
        return true;
    }
    // Case 2: pid.sick.com/1234567 (20 characters) - no separate serial
    else if (input.length === 20 && input.includes('pid.sick.com/')) {
        return false;
    }
    // Case 3: http://pid.sick.com/1234567 (27 characters) - no separate serial
    else if (input.length === 27 && input.includes('http://pid.sick.com/')) {
        return false;
    }
    // Case 4: 104631522440725 (15 characters) - has separate serial (last 8 digits)
    else if (input.length === 15) {
        return true;
    }
    // Case 5: 1234567 (7 characters) - no separate serial
    else if (input.length === 7) {
        return false;
    }
    // Case 6: 12345672022 (11 characters) - no separate serial
    else if (input.length === 11) {
        return false;
    }
    // Case 7: 12345672022X (12 characters) - no separate serial
    else if (input.length === 12) {
        return false;
    }
    
    return false;
}

// Function to update the list of extracted serial numbers
function updateSerialNumbersList() {
    const list = document.getElementById('serialNumbersList');
    const exportBtn = document.getElementById('exportBtn');
    list.innerHTML = '';
    // Sort parts by name for consistent display
    const sortedParts = Object.keys(extractedSerialsByPart).sort();
    const sortedNoSerialParts = Object.keys(extractedNoSerialCount).sort();
    if (sortedParts.length === 0 && sortedNoSerialParts.length === 0) {
        exportBtn.disabled = true;
        return;
    }
    // Render parts with serials
    sortedParts.forEach(partNumber => {
        const serialNumbers = extractedSerialsByPart[partNumber];
        // Create container for this part
        const partItem = document.createElement('div');
        partItem.className = 'serial-number-part-item';
        // Collapsed state
        let expanded = false;
        // Header row
        const header = document.createElement('div');
        header.className = 'part-header';
        // Triangle (expand/collapse)
        const triangle = document.createElement('span');
        triangle.className = 'triangle';
        triangle.innerHTML = '&#9654;'; // right-pointing triangle
        triangle.style.cursor = 'pointer';
        // Download icon
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'download-btn';
        downloadBtn.title = 'Download serials for this part';
        downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
        downloadBtn.style.marginLeft = '8px';
        // Part number label
        const partLabel = document.createElement('span');
        partLabel.className = 'part-label';
        partLabel.textContent = partNumber;
        partLabel.style.marginLeft = '8px';
        // Scanned quantity
        const qty = document.createElement('span');
        qty.className = 'scanned-qty';
        qty.textContent = `(${serialNumbers.length} scanned)`;
        qty.style.marginLeft = '8px';
        // Remove all button
        const removeAllBtn = document.createElement('button');
        removeAllBtn.className = 'remove-all-btn';
        removeAllBtn.title = 'Remove All';
        removeAllBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeAllBtn.style.marginLeft = '8px';
        // Header assembly
        header.appendChild(triangle);
        header.appendChild(downloadBtn);
        header.appendChild(partLabel);
        header.appendChild(qty);
        header.appendChild(removeAllBtn);
        partItem.appendChild(header);
        // Serial numbers list (hidden by default)
        const serialsListDiv = document.createElement('div');
        serialsListDiv.className = 'serial-numbers-list-container';
        serialsListDiv.style.display = 'none';
        serialNumbers.forEach((number, index) => {
            const item = document.createElement('div');
            item.className = 'serial-number-item';
            item.innerHTML = `
                <span>${index + 1}. ${number}</span>
                <button class="remove-btn" data-index="${index}" data-part="${partNumber}" title="Remove">
                    <i class="fas fa-times"></i>
                </button>
            `;
            // Remove button handler
            item.querySelector('.remove-btn').addEventListener('click', () => {
                extractedSerialsByPart[partNumber].splice(index, 1);
                if (extractedSerialsByPart[partNumber].length === 0) {
                    delete extractedSerialsByPart[partNumber];
                }
                updateSerialNumbersList();
            });
            serialsListDiv.appendChild(item);
        });
        partItem.appendChild(serialsListDiv);
        // Expand/collapse handler
        triangle.addEventListener('click', () => {
            expanded = !expanded;
            serialsListDiv.style.display = expanded ? 'block' : 'none';
            triangle.innerHTML = expanded ? '&#9660;' : '&#9654;'; // down or right triangle
        });
        // Download handler
        downloadBtn.addEventListener('click', () => {
            downloadSerialsForPart(partNumber, serialNumbers);
        });
        // Remove all handler
        removeAllBtn.addEventListener('click', () => {
            delete extractedSerialsByPart[partNumber];
            updateSerialNumbersList();
        });
        list.appendChild(partItem);
    });
    // Render parts with only counts (no serials)
    sortedNoSerialParts.forEach(partNumber => {
        // If this part also has serials, skip (already rendered above)
        if (extractedSerialsByPart[partNumber]) return;
        const count = extractedNoSerialCount[partNumber];
        const partItem = document.createElement('div');
        partItem.className = 'serial-number-part-item no-serial';
        // Just show part number and count, no expand/collapse or download
        const header = document.createElement('div');
        header.className = 'part-header';
        const partLabel = document.createElement('span');
        partLabel.className = 'part-label';
        partLabel.textContent = partNumber;
        partLabel.style.marginLeft = '8px';
        const qty = document.createElement('span');
        qty.className = 'scanned-qty';
        qty.textContent = `(${count} scanned)`;
        qty.style.marginLeft = '8px';
        // Remove all button
        const removeAllBtn = document.createElement('button');
        removeAllBtn.className = 'remove-all-btn';
        removeAllBtn.title = 'Remove All';
        removeAllBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeAllBtn.style.marginLeft = '8px';
        removeAllBtn.addEventListener('click', () => {
            delete extractedNoSerialCount[partNumber];
            updateSerialNumbersList();
        });
        header.appendChild(partLabel);
        header.appendChild(qty);
        header.appendChild(removeAllBtn);
        partItem.appendChild(header);
        list.appendChild(partItem);
    });
    // Enable/disable export button (only if there are serials to export)
    exportBtn.disabled = Object.keys(extractedSerialsByPart).length === 0;
}

// Helper: Download serials for a part as a text file
function downloadSerialsForPart(partNumber, serialNumbers) {
    const content = serialNumbers.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${partNumber}_serials.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// Function to toggle the extractor scanner
function toggleExtractorScanner() {
    const readerDiv = document.getElementById('extractorReader');
    const toggleButton = document.getElementById('extractorScannerBtn');

    if (!extractorScannerInstance) {
        // Start scanner
        readerDiv.style.display = 'block';
        toggleButton.classList.add('active');
        
        extractorScannerInstance = new Html5Qrcode("extractorReader");
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
        };

        extractorScannerInstance.start(
            { facingMode: "environment" },
            config,
            handleExtractorScanSuccess,
            onScanError
        )
        .then(() => {
            console.log("Extractor scanner started successfully");
        })
        .catch((err) => {
            console.error("Error starting extractor scanner:", err);
            alert("Could not start camera scanner. Please check camera permissions.");
            stopExtractorScanner();
        });
    } else {
        stopExtractorScanner();
    }
}

// Function to stop the extractor scanner
function stopExtractorScanner() {
    if (extractorScannerInstance) {
        extractorScannerInstance.stop()
            .then(() => {
                console.log('Extractor scanner stopped');
                document.getElementById('extractorReader').style.display = 'none';
                document.getElementById('extractorScannerBtn').classList.remove('active');
                extractorScannerInstance = null;
            })
            .catch((err) => {
                console.error('Error stopping extractor scanner:', err);
            });
    }
}

// Function to handle successful scans in extractor mode
function handleExtractorScanSuccess(decodedText, decodedResult) {
    // Stop scanning after successful scan
    stopExtractorScanner();
    
    // Set the scanned value to the input
    const extractorInput = document.getElementById('extractorInput');
    extractorInput.value = decodedText;
    
    // Trigger the scan handling
    extractorInput.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true
    }));
}

// Function to export serial numbers
async function exportSerialNumbers() {
    if (Object.keys(extractedSerialsByPart).length === 0) return;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionName = `session_${timestamp}_serial_extractor`;
    
    try {
        // First, try to save the serial numbers
        const saveResponse = await fetch('/save-extracted-serials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sessionName: sessionName,
                serialNumbersByPart: extractedSerialsByPart
            })
        });

        if (!saveResponse.ok) {
            const errorData = await saveResponse.json();
            throw new Error(errorData.error || 'Failed to save serial numbers');
        }

        // If save was successful, try to download
        const downloadResponse = await fetch(`/download-session/${sessionName}`);
        if (!downloadResponse.ok) {
            throw new Error('Failed to download file');
        }

        // Create a blob from the response and trigger download
        const blob = await downloadResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sessionName}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
        // Clear the list after successful export
        extractedSerialsByPart = {};
        updateSerialNumbersList();
        
    } catch (error) {
        console.error('Error exporting serial numbers:', error);
        alert(`Error exporting serial numbers: ${error.message}`);
    }
}

// Add this function at the end of the file or after handleFileUpload
function renderUploadedItemsTable(items) {
    const container = document.getElementById('uploadedItemsTableContainer');
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = '<p>No items to display.</p>';
        return;
    }
    let tableHtml = `<div style="overflow-x:auto;"><table class="uploaded-items-table" style="width:100%;border-collapse:collapse;margin-top:20px;">
        <thead>
            <tr>
                <th style='padding:8px;border-bottom:1px solid #ccc;'>Item Code</th>
                <th style='padding:8px;border-bottom:1px solid #ccc;'>Company</th>
                <th style='padding:8px;border-bottom:1px solid #ccc;'>Part Number</th>
                <th style='padding:8px;border-bottom:1px solid #ccc;'>Quantity</th>
            </tr>
        </thead>
        <tbody>`;
    items.forEach(item => {
        tableHtml += `<tr>
            <td style='padding:8px;border-bottom:1px solid #eee;'>${item.itemCode || ''}</td>
            <td style='padding:8px;border-bottom:1px solid #eee;'>${item.company || ''}</td>
            <td style='padding:8px;border-bottom:1px solid #eee;'>${item.partNumber || ''}</td>
            <td style='padding:8px;border-bottom:1px solid #eee;'>${item.scansRequired || ''}</td>
        </tr>`;
    });
    tableHtml += `</tbody></table></div>`;
    container.innerHTML = tableHtml;
}

// ----- STOCK TAKE FUNCTIONS -----

function toggleStockTakeMode() {
    const mainContainer = document.getElementById('mainContainer');
    const extractorContainer = document.getElementById('extractorContainer');
    const stockTakeContainer = document.getElementById('stockTakeContainer');

    if (stockTakeContainer.style.display !== 'none') {
        // Switch back to main mode
        mainContainer.style.display = 'grid';
        extractorContainer.style.display = 'none';
        stockTakeContainer.style.display = 'none';
        document.getElementById('scanInput').focus();
    } else {
        // Switch to stock take mode
        mainContainer.style.display = 'none';
        extractorContainer.style.display = 'none';
        stockTakeContainer.style.display = 'block';
        document.getElementById('stockTakeScanInput').focus();
        // Clear previous state
        stockTakeItems = [];
        stockTakeScannedCounts = {};
        renderStockTakeTable();
    }
}

function handleStockTakeUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    fetch('/upload-stock-take', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }
        stockTakeItems = data.items.map(item => ({ ...item, scanned: 0 }));
        stockTakeScannedCounts = {}; // Reset counts
        renderStockTakeTable();
        document.getElementById('stockTakeScanInput').focus();
    })
    .catch(error => {
        console.error('Error uploading stock take file:', error);
        alert('Failed to upload or process stock take file.');
    });
}

function renderStockTakeTable() {
    const container = document.getElementById('stockTakeTableContainer');
    if (stockTakeItems.length === 0) {
        container.innerHTML = '';
        return;
    }
    let tableHtml = `
        <div id="stockTakeErrorMsg" style="color:#e53e3e;margin-bottom:10px;"></div>
        <table class="stock-take-table">
            <thead>
                <tr>
                    <th>Part Number</th>
                    <th>Scanned / Quantity</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
    `;
    stockTakeItems.forEach((item, index) => {
        tableHtml += `
            <tr id="stock-item-row-${index}">
                <td>${item.partNumber}</td>
                <td>${item.scanned} / ${item.quantity}</td>
                <td>
                    <button class="remove-stock-item-btn" data-index="${index}" title="Remove Item">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    tableHtml += '</tbody></table>';
    container.innerHTML = tableHtml;

    // Add event listeners for remove buttons
    document.querySelectorAll('.remove-stock-item-btn').forEach(btn => {
        btn.addEventListener('click', (event) => {
            const indexToRemove = parseInt(event.currentTarget.getAttribute('data-index'), 10);
            stockTakeItems.splice(indexToRemove, 1);
            renderStockTakeTable();
        });
    });
}

function handleStockTakeScan(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const scanInput = event.target;
        const userInput = scanInput.value.trim();
        const scannedPartNumber = extractPartNumber(userInput);
        const errorMsgDiv = document.getElementById('stockTakeErrorMsg');
        if (errorMsgDiv) errorMsgDiv.textContent = '';
        if (!scannedPartNumber) {
            highlightError(scanInput);
            playErrorSound();
            if (errorMsgDiv) errorMsgDiv.textContent = 'item not found';
            scanInput.value = '';
            scanInput.focus();
            return;
        }
        const itemIndex = stockTakeItems.findIndex(item => item.partNumber === scannedPartNumber);
        if (itemIndex !== -1) {
            const item = stockTakeItems[itemIndex];
            if (item.scanned < item.quantity) {
                item.scanned++;
                successSound.currentTime = 0;
                successSound.play().catch(() => {});
                // Remove item if done
                if (item.scanned >= item.quantity) {
                    stockTakeItems.splice(itemIndex, 1);
                }
                renderStockTakeTable();
            } else {
                playErrorSound();
                highlightError(scanInput, 500);
            }
        } else {
            highlightError(scanInput);
            playErrorSound();
            if (errorMsgDiv) errorMsgDiv.textContent = 'item not found';
        }
        scanInput.value = '';
        scanInput.focus();
    }
}

// Camera scanner logic for stock take
let stockTakeScannerInstance = null;
function toggleStockTakeScanner() {
    const scanInput = document.getElementById('stockTakeScanInput');
    const readerDivId = 'stockTakeReader';
    let readerDiv = document.getElementById(readerDivId);
    if (!readerDiv) {
        readerDiv = document.createElement('div');
        readerDiv.id = readerDivId;
        readerDiv.style.marginTop = '10px';
        document.querySelector('.scan-input-container').appendChild(readerDiv);
    }
    if (!stockTakeScannerInstance) {
        readerDiv.style.display = 'block';
        stockTakeScannerInstance = new Html5Qrcode(readerDivId);
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
        };
        stockTakeScannerInstance.start(
            { facingMode: 'environment' },
            config,
            (decodedText) => {
                stopStockTakeScanner();
                document.getElementById('stockTakeScanInput').value = decodedText;
                document.getElementById('stockTakeScanInput').dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                }));
            },
            (error) => {}
        ).catch((err) => {
            alert('Could not start camera scanner. Please check camera permissions.');
            stopStockTakeScanner();
        });
    } else {
        stopStockTakeScanner();
    }
}
function stopStockTakeScanner() {
    if (stockTakeScannerInstance) {
        stockTakeScannerInstance.stop().then(() => {
            document.getElementById('stockTakeReader').style.display = 'none';
            stockTakeScannerInstance = null;
        }).catch(() => {});
    }
}
// ----- END STOCK TAKE FUNCTIONS ----- 