let currentPartNumber = '';
let scansRemaining = 0;
let allItems = [];
let currentItemIndex = 0;
let isMobileDevice = false;

// Add error sound
const errorSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

// Add variable to track modal state
let isNetworkModalOpen = false;
let networkRefreshInterval = null;

// Add scanner variables
let html5QrcodeScanner = null;
let isScannerActive = false;

// Add variable to track current session
let currentSession = '';

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
            
            // Display the first item
            displayCurrentItem();
            
            // Update the upload section
            const uploadSection = document.querySelector('.upload-section');
            uploadSection.innerHTML = `
                <p>Using shared Excel data. Uploaded: ${new Date(data.timestamp).toLocaleString()}</p>
                <p>Total items: ${allItems.length}</p>
            `;
            
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
                    <button id="viewSessions" class="action-button secondary">View Previous Sessions</button>
                `;
                
                // Add listener for the view sessions button
                document.getElementById('viewSessions').addEventListener('click', showSessionsModal);
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
    document.getElementById('partNumber').textContent = currentItem.partNumber || 'N/A';
    document.getElementById('scansLeft').textContent = currentItem.scansRequired || '0';
    currentPartNumber = currentItem.partNumber;
    scansRemaining = currentItem.scansRequired;

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
    // Case 3: 104631522440725 (15 characters - first 7 digits)
    else if (input.length === 15) {
        return input.substring(0, 7);
    }
    // Case 4: 1234567 (7 characters)
    else if (input.length === 7) {
        return input;
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
    // Case 3: 104631522440725 -> extract last 8 digits (22440725)
    else if (input.length === 15) {
        return input.slice(-8);
    }
    // Case 4: 1234567 -> return as is
    else if (input.length === 7) {
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
                
                scansRemaining--;
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