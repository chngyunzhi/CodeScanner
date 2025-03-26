let currentPartNumber = '';
let scansRemaining = 0;
let allItems = [];
let currentItemIndex = 0;
let isMobileDevice = false;

// Add error sound
const errorSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

// Check if user is on mobile device
fetch('/check-mobile')
    .then(response => response.json())
    .then(data => {
        isMobileDevice = data.isMobile;
        updateFolderButton();
    })
    .catch(error => console.error('Error checking device type:', error));

document.getElementById('fileInput').addEventListener('change', handleFileUpload);
document.getElementById('scanInput').addEventListener('keydown', handleScan);
document.getElementById('skipButton').addEventListener('click', handleSkip);
document.getElementById('backButton').addEventListener('click', handleBack);
document.getElementById('openFolderBtn').addEventListener('click', handleFolderClick);
document.getElementById('showNetworkBtn').addEventListener('click', showNetworkInfo);
document.querySelector('.close').addEventListener('click', hideNetworkInfo);
window.addEventListener('click', (event) => {
    const modal = document.getElementById('networkModal');
    if (event.target === modal) {
        hideNetworkInfo();
    }
});

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
                displayCurrentItem();
                document.getElementById('scanInput').focus();
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
    fetch('/network-info')
        .then(response => response.json())
        .then(data => {
            const modal = document.getElementById('networkModal');
            const qrCodeDiv = document.getElementById('qrCode');
            const addressList = document.getElementById('addressList');
            
            // Clear previous content
            qrCodeDiv.innerHTML = '';
            addressList.innerHTML = '';
            
            // Only generate QR code if public URL is available
            if (data.publicUrl) {
                new QRCode(qrCodeDiv, {
                    text: data.publicUrl,
                    width: 200,
                    height: 200,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });

                // Display public URL
                const publicUrlItem = document.createElement('div');
                publicUrlItem.className = 'public-url';
                publicUrlItem.textContent = data.publicUrl;
                addressList.appendChild(publicUrlItem);
            } else {
                const errorMsg = document.createElement('div');
                errorMsg.className = 'error-message';
                errorMsg.textContent = 'Public URL not available. Please try again in a moment.';
                addressList.appendChild(errorMsg);
            }

            // Display local network addresses
            if (data.addresses.length > 0) {
                const header = document.createElement('div');
                header.className = 'address-header';
                header.textContent = 'Local Network Access:';
                addressList.appendChild(header);

                data.addresses.forEach(address => {
                    const li = document.createElement('li');
                    li.textContent = `http://${address}:${data.port}`;
                    addressList.appendChild(li);
                });
            }

            modal.style.display = 'block';
        })
        .catch(error => {
            console.error('Error fetching network info:', error);
            alert('Error getting network information');
        });
}

// Function to hide network information
function hideNetworkInfo() {
    const modal = document.getElementById('networkModal');
    modal.style.display = 'none';
    // Restore focus to scan input after closing modal
    document.getElementById('scanInput').focus();
} 