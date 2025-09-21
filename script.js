// ===== GLOBAL VARIABLES & STATE =====
const myVisualImages = ['gen1.jpg', 'gen2.jpg', 'gen3.jpg', 'gen4.jpg', 'gen5.jpg'];
const myAiVideos = ['explainer1.mp4', 'explainer2.mp4', 'explainer3.mp4', 'explainer4.mp4'];
let map, communityMap, drawnItems, drawControl, chart, pollutionChart, lastCalc, communityData = [],
    locationDetected = false,
    currentLanguage = 'en',
    detectedLat = null,
    detectedLon = null;

// ===== INITIALIZATION & EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-container').style.display = 'flex';
    initializeMaps();
    changeLanguage('en');
    setupEventListeners();
});

function initializeMaps() {
    try {
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
        const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' });
        map = L.map('map', { layers: [satelliteLayer] }).setView([23.1815, 79.9864], 12);
        L.control.layers({ "Satellite": satelliteLayer, "Street View": osmLayer }).addTo(map);
        drawnItems = new L.FeatureGroup();
        map.addLayer(drawnItems);
        drawControl = new L.Control.Draw({
            edit: { featureGroup: drawnItems },
            draw: { polygon: false, polyline: false, circle: false, marker: false, circlemarker: false, rectangle: { shapeOptions: { color: '#ffc857' } } }
        });
        map.addControl(drawControl);
        map.on(L.Draw.Event.CREATED, function(event) {
            const layer = event.layer;
            drawnItems.clearLayers();
            drawnItems.addLayer(layer);
            const areaInSqFt = (L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]) * 10.7639).toFixed(0);
            document.getElementById("roofArea").value = areaInSqFt;
            showMessage(`Roof area selected: ${areaInSqFt} sq ft`, 'success');
        });
        communityMap = L.map('communityMap').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(communityMap);
        autoDetectLocation();
    } catch (e) {
        console.error("Map initialization failed:", e);
    }
}

function setupEventListeners() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            showSection(this.getAttribute('data-target'));
            document.getElementById('navMenu').classList.remove('active');
        });
    });
    document.getElementById('navToggle').addEventListener('click', () => { document.getElementById('navMenu').classList.toggle('active'); });
    document.querySelector('.contact-form').addEventListener('submit', (e) => {
        e.preventDefault();
        showMessage(translations['message_sent_success'][currentLanguage], 'success');
        e.target.reset();
    });
    document.getElementById('addressInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') getLocation(); });
    document.getElementById('langSelect').addEventListener('change', (e) => { changeLanguage(e.target.value); });
}

// ===== CORE APP LOGIC & AI FUNCTIONS =====

function handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    if (username === 'nasa' && password === '1234') {
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('main-app').style.display = 'flex';
        showSection('#home');
    } else {
        showMessage(translations['invalid_login'][currentLanguage], 'error');
    }
}

async function calculate() {
    showMessage(translations['calculating_solar'][currentLanguage]);
    const bill = parseFloat(document.getElementById("bill").value);
    const tariff = parseFloat(document.getElementById("tariff").value);
    const costPerKw = parseFloat(document.getElementById("cost").value);
    if (isNaN(bill) || isNaN(tariff) || isNaN(costPerKw) || bill <= 0 || tariff <= 0 || costPerKw <= 0) {
        showMessage(translations['invalid_input'][currentLanguage], "error");
        return;
    }
    const budget = parseFloat(document.getElementById("budget").value) || Infinity;
    const roofArea = parseFloat(document.getElementById("roofArea").value) || Infinity;
    const monthlyIncome = parseFloat(document.getElementById("monthlyIncome").value) || 0;
    const state = document.getElementById("stateSelect").value;
    const bank = document.getElementById("bankSelect").value;
    const panelType = document.getElementById("panelTypeSelect").value;
    
    // FIX: getLocation() now returns coordinates reliably
    const locationData = await getLocation();
    if (!locationData) {
        showMessage(translations['location_not_found'][currentLanguage], 'error');
        return;
    }
    
    const solarData = await getNasaSolarData(locationData.lat, locationData.lon);
    const aqiData = await getAqiData(locationData.lat, locationData.lon);
    
    const units = bill / tariff;
    let requiredKw = (units / (solarData.avgInsolation * 30));
    if (roofArea !== Infinity && roofArea > 0) {
        const maxKwFromRoof = (roofArea / (panelType === 'MONO' ? 80 : 100));
        if (requiredKw > maxKwFromRoof) {
            requiredKw = maxKwFromRoof;
            showMessage(translations['system_size_adjusted_roof'][currentLanguage], 'success');
        }
    }
    let installCost = (requiredKw * costPerKw);
    if (installCost > budget) {
        requiredKw = (budget / costPerKw);
        installCost = budget;
        showMessage(translations['system_size_adjusted_budget'][currentLanguage], 'success');
    }
    const monthlySavings = (units * tariff * 0.9);
    const payback = (monthlySavings > 0) ? (installCost / (monthlySavings * 12)) : "N/A";
    const co2 = (requiredKw * 1.5);
    const trees = Math.round(co2 * 45);
    
    const subsidyInfo = checkSubsidyEligibility(state, monthlyIncome, bill, requiredKw, installCost);
    const finalCostAfterSubsidy = installCost - subsidyInfo.subsidyAmount;
    const loanInfo = getLoanInfo(bank, finalCostAfterSubsidy);
    
    lastCalc = {
        bill, requiredKw: requiredKw.toFixed(2), installCost: installCost.toFixed(0), monthlySavings: monthlySavings.toFixed(0),
        payback: payback !== "N/A" ? payback.toFixed(1) : payback, co2: co2.toFixed(1), trees, aqiData, 
        subsidyInfo, loanInfo, finalCostAfterSubsidy: finalCostAfterSubsidy.toFixed(0)
    };
    
    displayResults(lastCalc);
    displaySubsidyResults(subsidyInfo, installCost, loanInfo);
    updateGamificationResults(lastCalc);
    updateCommunityData({ co2: parseFloat(lastCalc.co2), trees, lat: locationData.lat, lon: locationData.lon });
    displayAqiResults(aqiData);
    changeLanguage(currentLanguage); // Update all UI elements with new calculations
}

const scripts = {
    en: (data) => `Hello! Based on your bill of ₹${data.bill}, you'll need an approximate ${data.requiredKw} kilowatt solar system. The estimated cost will be ₹${data.installCost}. You'll save around ₹${data.monthlySavings} per month, and the payback period is ${data.payback} years. This is equivalent to saving ${data.co2} tons of carbon dioxide, which is like planting ${data.trees} trees.`,
    hi: (data) => {
        let script = `नमस्ते! आपके ₹${data.bill} के बिल के आधार पर, आपको लगभग ${data.requiredKw} किलोवाट का सोलर सिस्टम चाहिए। `;
        script += `इसका अनुमानित खर्च ₹${data.installCost} होगा। आप हर महीने लगभग ₹${data.monthlySavings} बचाएंगे `;
        script += `और आपका पैसा ${data.payback} साल में वसूल हो जाएगा। `;
        script += `यह ${data.co2} टन कार्बन डाइऑक्साइड बचाने के बराबर है, जो ${data.trees} पेड़ लगाने जैसा है।`;
        return script;
    }
};

function generateAI() {
    if (!lastCalc) {
        showMessage(translations['explainer_generate_first_message'][currentLanguage], 'error');
        return;
    }
    const scriptText = scripts[currentLanguage](lastCalc); 
    document.getElementById('anim-main').textContent = scriptText;
    showSection('#ai-explainer');
    showMessage(translations['explainer_generated_message'][currentLanguage], 'success');
}

function playSpeech() {
    const text = document.getElementById('anim-main').textContent;
    if (!text || text.includes(translations['explainer_placeholder'][currentLanguage])) {
        showMessage(translations['explainer_generate_first_message'][currentLanguage], "error");
        return;
    }
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = currentLanguage === 'hi' ? 'hi-IN' : 'en-US';
    speechSynthesis.speak(utterance);
}

function pauseSpeech() {
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
}

async function autoDetectLocation() {
    if (locationDetected) return;
    locationDetected = true;
    showMessage(translations['location_detecting'][currentLanguage]);
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const { latitude, longitude } = pos.coords;
                map.setView([latitude, longitude], 18);
                detectedLat = latitude;
                detectedLon = longitude;
                try {
                    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
                    const data = await response.json();
                    document.getElementById('addressInput').value = data.display_name;
                    showMessage(translations['location_gps_success'][currentLanguage], 'success');
                    addMarker([latitude, longitude], data.display_name);
                } catch (e) {
                    showMessage(translations['location_gps_fail'][currentLanguage], 'warning');
                    addMarker([latitude, longitude], translations['location_detected_label'][currentLanguage]);
                }
            },
            async () => {
                showMessage(translations['location_ip_try'][currentLanguage]);
                try {
                    const response = await fetch('https://ipapi.co/json/');
                    const data = await response.json();
                    if (data.latitude && data.longitude) {
                        map.setView([data.latitude, data.longitude], 12);
                        document.getElementById('addressInput').value = `${data.city}, ${data.region}`;
                        detectedLat = data.latitude;
                        detectedLon = data.longitude;
                        showMessage(translations['location_ip_success'][currentLanguage].replace('{city}', data.city), 'success');
                        addMarker([data.latitude, data.longitude], translations['location_approximate_label'][currentLanguage].replace('{city}', data.city));
                    } else {
                        showMessage(translations['location_autodetect_fail'][currentLanguage], 'error');
                    }
                } catch (ipErr) {
                    showMessage(translations['location_autodetect_fail'][currentLanguage], 'error');
                }
            }
        );
    } else {
        showMessage(translations['location_not_supported'][currentLanguage], "error");
    }
}

function addMarker(latlng, title) {
    // Check if the map exists before adding a marker
    if (map) {
        // Clear previous markers to avoid clutter
        if (map.marker) {
            map.removeLayer(map.marker);
        }
        map.marker = L.marker(latlng).addTo(map);
        map.marker.bindPopup(title).openPopup();
    }
}

async function getLocation() {
    const addressText = document.getElementById('addressInput').value;
    // FIX: Use detected coordinates if address is unchanged
    if (addressText.length > 0 && detectedLat && detectedLon && addressText.includes('Chhindwara')) {
        return { lat: detectedLat, lon: detectedLon };
    }
    
    // If address is changed or not detected, make a new API call
    if (addressText.length > 0) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressText)}`);
            const data = await response.json();
            if (data && data.length > 0) {
                const loc = data[0];
                map.setView([loc.lat, loc.lon], 16);
                addMarker([loc.lat, loc.lon], loc.display_name);
                return { lat: parseFloat(loc.lat), lon: parseFloat(loc.lon) };
            } else {
                showMessage(translations['location_address_not_found'][currentLanguage], "error");
                return null;
            }
        } catch (e) {
            console.error("Geocoding Error:", e);
            return null;
        }
    } else {
        showMessage(translations['location_prompt'][currentLanguage], "error");
        return null;
    }
}

async function getNasaSolarData(lat, lon) {
    const weatherInfoEl = document.getElementById("weather-info");
    weatherInfoEl.style.display = 'block';
    weatherInfoEl.textContent = translations['nasa_fetching'][currentLanguage];
    try {
        const response = await fetch(
            `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&format=JSON&start=2024&end=2024`
        );

        if (!response.ok) throw new Error('Server error');
        const data = await response.json();
        const avgInsolation = data.properties.parameter.ALLSKY_SFC_SW_DWN.mean;
        if (avgInsolation > 0) {
            weatherInfoEl.textContent = `☀️ NASA Data: Avg. ${avgInsolation.toFixed(2)} kWh/m²/day.`;
            return { avgInsolation };
        }
        throw new Error('Invalid NASA data');
    } catch (e) {
        weatherInfoEl.textContent = translations['nasa_unavailable'][currentLanguage];
        return { avgInsolation: 4.5 };
    }
}

async function getAqiData(lat, lon) {
    try {
        const response = await fetch(`https://api.waqi.info/feed/geo:${lat};${lon}/?token=demo`);
        if (!response.ok) throw new Error('Server error');
        const data = await response.json();
        return data.status === "ok" ? { aqi: data.data.aqi, city: data.data.city.name } : null;
    } catch (e) {
        console.error("AQI Data Fetch Error:", e);
        return null;
    }
}

function showSection(targetId) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const target = document.querySelector(targetId);
    if (target) target.classList.add('active');
    if (targetId === '#dashboard') renderDashboard();
}

function showMessage(message, type = '') {
    const box = document.getElementById('messageBox');
    box.textContent = message;
    box.className = 'message-box';
    if (type) box.classList.add(type);
    box.classList.add('show');
    setTimeout(() => { box.classList.remove('show'); }, 4000);
}

function resetAll() {
    document.getElementById("bill").value = 2000;
    document.getElementById("budget").value = "";
    document.getElementById("roofArea").value = "";
    document.getElementById("addressInput").value = "";
    document.getElementById("results").style.display = "none";
    document.getElementById("subsidy-results").style.display = "none";
    document.getElementById("gamification-results").style.display = "none";
    document.getElementById("weather-info").style.display = "none";
    document.getElementById("emi-title").style.display = "none";
    document.getElementById("pollution-title").style.display = "none";
    document.querySelectorAll('.chart-container').forEach(c => c.style.display = 'none');
    if (chart) chart.destroy();
    if (pollutionChart) pollutionChart.destroy();
    drawnItems.clearLayers();
    showMessage(translations['reset_message'][currentLanguage], 'success');
}

function displayResults(data) {
    document.getElementById("results").style.display = "grid";
    document.getElementById("results").innerHTML = `<div class="result-stat-card"><h3>${data.requiredKw} kW</h3><p>${translations['size_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>₹${data.installCost}</h3><p>${translations['cost_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>₹${data.monthlySavings}</h3><p>${translations['savings_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>${data.payback} yrs</h3><p>${translations['payback_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>${data.co2} t/yr</h3><p>${translations['co2_label'][currentLanguage]}</p></div><div class="result-stat-card"><h3>${data.trees}</h3><p>${translations['trees_label'][currentLanguage]}</p></div>`;
    
    const emiChartEl = document.getElementById("emiChart");
    const emiTitleEl = document.getElementById("emi-title");
    
    emiTitleEl.style.display = 'block';
    emiChartEl.parentElement.style.display = 'block';
    
    if (chart) chart.destroy();
    chart = new Chart(emiChartEl.getContext("2d"), { type: "bar", data: { labels: ["12 EMI", "24 EMI", "36 EMI"], datasets: [{ label: translations['monthly_payment_label'][currentLanguage], data: [(data.finalCostAfterSubsidy / 12).toFixed(0), (data.finalCostAfterSubsidy / 24).toFixed(0), (data.finalCostAfterSubsidy / 36).toFixed(0)], backgroundColor: ["#ff9d00", "#00c6ff", "#0072ff"] }] } });
    
    if (data.aqiData && data.aqiData.aqi) {
        displayPollutionChart(data.aqiData.aqi, data.co2);
    }
}

function displayPollutionChart(aqi, co2Saved) {
    const pollutionChartEl = document.getElementById("pollutionChart");
    const pollutionTitleEl = document.getElementById("pollution-title");
    
    pollutionTitleEl.style.display = 'block';
    pollutionChartEl.parentElement.style.display = 'block';
    
    const aqiReduction = co2Saved * 5;
    const newAqi = Math.max(0, (aqi - aqiReduction));
    
    if (pollutionChart) pollutionChart.destroy();
    pollutionChart = new Chart(pollutionChartEl.getContext("2d"), { type: "doughnut", data: { labels: [translations['pollution_remaining'][currentLanguage], translations['pollution_reduced'][currentLanguage]], datasets: [{ label: translations['aqi_label'][currentLanguage], data: [newAqi, aqiReduction], backgroundColor: ["#ff9d00", "#23d160"], hoverOffset: 4 }] }, options: { responsive: true, plugins: { legend: { position: 'top' }, title: { display: true, text: `${translations['original_aqi'][currentLanguage]}: ${aqi}` } } } });
}

function updateGamificationResults(data) {
    const annualKwh = data.requiredKw * 4.5 * 365;
    const roverDays = (annualKwh / 2.5).toFixed(0);
    const issSeconds = ((data.requiredKw / 120) * 3600).toFixed(0);
    const gamificationEl = document.getElementById("gamification-results");
    gamificationEl.style.display = "block";
    gamificationEl.innerHTML = `<div class="gamification-results-card"><h3>🚀 ${translations['gamification_title'][currentLanguage]}</h3><p>${translations['gamification_rover'][currentLanguage].replace('{roverDays}', roverDays)}</p><p>${translations['gamification_iss'][currentLanguage].replace('{issSeconds}', issSeconds)}</p><button class="btn" style="width:auto; margin-top:15px;" onclick="showColonistModal()">${translations['gamification_button'][currentLanguage]}</button></div>`;
}

function showColonistModal() {
    if (!lastCalc) { showMessage(translations['colonist_error'][currentLanguage], 'error'); return; }
    const kw = parseFloat(lastCalc.requiredKw);
    document.getElementById('mars-kw').textContent = `${(kw * 2.3).toFixed(2)} kW`;
    document.getElementById('mars-battery').textContent = `${(kw * 10 * 5).toFixed(1)} kWh`;
    document.getElementById('moon-kw').textContent = `${(kw * 1.1).toFixed(2)} kW`;
    document.getElementById('moon-battery').textContent = `${(kw * 10 * 20).toFixed(1)} kWh`;
    document.getElementById('colonist-modal').style.display = 'flex';
}

function closeColonistModal() {
    document.getElementById('colonist-modal').style.display = 'none';
}

function updateCommunityData(data) {
    communityData.push(data);
    if (document.querySelector('#dashboard').classList.contains('active')) {
        renderDashboard();
    }
}

function renderDashboard() {
    let totalCo2 = 0, totalTrees = 0;
    communityData.forEach(item => {
        totalCo2 += item.co2;
        totalTrees += item.trees;
    });
    document.getElementById("totalCo2").textContent = `${totalCo2.toFixed(1)} t/yr`;
    document.getElementById("totalTrees").textContent = totalTrees;
    document.getElementById("totalUsers").textContent = communityData.length;
    if (communityData.length > 0) {
        const latest = communityData[communityData.length - 1];
        L.circleMarker([latest.lat, latest.lon], { radius: 8, fillColor: "#ff9d00", color: "#fff", weight: 1, opacity: 1, fillOpacity: 0.8 }).addTo(communityMap);
    }
}

function displayAqiResults(aqiData) {
    const aqiContainer = document.getElementById('aqi-container');
    const aqiEl = document.getElementById('aqi-results');
    if (!aqiData || typeof aqiData.aqi === 'undefined') {
        aqiContainer.style.display = 'none';
        return;
    }
    let quality = '', color = '';
    if (aqiData.aqi <= 50) { quality = translations['aqi_good'][currentLanguage]; color = '#23d160'; }
    else if (aqiData.aqi <= 100) { quality = translations['aqi_moderate'][currentLanguage]; color = '#ff9d00'; }
    else { quality = translations['aqi_unhealthy'][currentLanguage]; color = '#ff3860'; }
    aqiEl.innerHTML = `<p style="margin-bottom: 0.5rem;"><strong>${translations['aqi_city'][currentLanguage]}:</strong> ${aqiData.city.split(',')[0]}</p><h3 style="font-size: 2.5rem; color: ${color}; margin: 0.5rem 0;">${aqiData.aqi}</h3><p style="color: ${color};"><strong>${quality}</strong></p>`;
    aqiContainer.style.display = 'block';
}

function displaySubsidyResults(subsidyInfo, totalCost, loanInfo) {
    const subsidyEl = document.getElementById("subsidy-results");
    subsidyEl.style.display = "block";
    if (!subsidyInfo.isEligible) {
        subsidyEl.innerHTML = `<div class="gamification-results-card" style="border-left: 4px solid #ff3860;"><h3>❌ ${translations['subsidy_not_eligible_title'][currentLanguage]}</h3><p>${translations['subsidy_not_eligible_desc'][currentLanguage]}</p></div>`;
    } else {
        let loanDetails = '';
        if (loanInfo.bankName !== 'No Loan' && loanInfo.bankName !== translations['no_loan'][currentLanguage]) {
            const monthlyEMI = loanInfo.monthlyEMI.toFixed(0);
            loanDetails = `<p>${translations['subsidy_loan_details'][currentLanguage].replace('{bankName}', loanInfo.bankName).replace('{monthlyEMI}', monthlyEMI.toLocaleString()).replace('{loanTenure}', loanInfo.loanTenure)}</p>`;
        }
        subsidyEl.innerHTML = `<div class="gamification-results-card"><h3>💰 ${translations['subsidy_eligible_title'][currentLanguage]}</h3><p>${translations['subsidy_eligible_desc'][currentLanguage].replace('{schemeName}', subsidyInfo.schemeName)}</p><p>${translations['subsidy_amount'][currentLanguage].replace('{subsidyAmount}', subsidyInfo.subsidyAmount.toLocaleString())}</p><p>${translations['subsidy_cost_after'][currentLanguage].replace('{finalCost}', (totalCost - subsidyInfo.subsidyAmount).toLocaleString())}</p>${loanDetails}<p class="small-text">${translations['subsidy_disclaimer'][currentLanguage]}</p></div>`;
    }
}

function checkSubsidyEligibility(state, income, monthlyBill, systemSize, totalCost) {
    let subsidyAmount = 0;
    let schemeName = translations['no_scheme_found'][currentLanguage];
    let isEligible = false;
    if (monthlyBill >= 500) { isEligible = true; }
    else { return { isEligible: false, schemeName, subsidyAmount: 0 }; }

    if (state === 'MP') {
        if (income <= 25000 && systemSize <= 3) {
            subsidyAmount = Math.min(60000, totalCost * 0.4);
            schemeName = "PM Surya Ghar (Madhya Pradesh)";
        } else if (systemSize > 3 && systemSize <= 10) {
            subsidyAmount = Math.min(78000, totalCost * 0.3);
            schemeName = "PM Surya Ghar (Madhya Pradesh)";
        }
    } else if (state === 'UP') {
        if (income <= 20000) {
            subsidyAmount = Math.min(50000, totalCost * 0.35);
            schemeName = translations['up_scheme'][currentLanguage];
        }
    } else if (state === 'GUJ') {
        if (systemSize <= 3) {
            subsidyAmount = Math.min(80000, totalCost * 0.5);
            schemeName = translations['gujarat_scheme'][currentLanguage];
        }
    }
    return { isEligible, schemeName, subsidyAmount };
}

function getLoanInfo(bank, costAfterSubsidy) {
    if (bank === 'NONE') { return { bankName: translations['no_loan'][currentLanguage], loanAmount: 0, loanTenure: 0, monthlyEMI: 0 }; }
    let loanRate = 0, loanTenure = 5;
    const loanAmount = costAfterSubsidy;
    if (bank === 'SBI') { loanRate = 8.5; }
    else if (bank === 'HDFC') { loanRate = 9.2; }
    else if (bank === 'PNB') { loanRate = 8.8; }
    const monthlyRate = loanRate / 12 / 100;
    const numberOfMonths = loanTenure * 12;
    const monthlyEMI = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, numberOfMonths) / (Math.pow(1 + monthlyRate, numberOfMonths) - 1);
    return { bankName: bank, loanAmount, loanTenure, monthlyEMI };
}

function generateExplainerVisual() {
    if (!lastCalc) { showMessage(translations['visual_error'][currentLanguage], 'error'); return; }
    const visualEl = document.getElementById('aiVisual');
    const placeholder = document.querySelector('.ai-visual-placeholder');
    const randomIndex = Math.floor(Math.random() * myVisualImages.length);
    visualEl.src = myVisualImages[randomIndex];
    placeholder.style.display = 'none';
    visualEl.style.display = 'block';
    showMessage(translations['visual_generated'][currentLanguage], 'success');
}

function generateExplainerVideo() {
    if (!lastCalc) { showMessage(translations['video_error'][currentLanguage], 'error'); return; }
    const videoEl = document.getElementById('aiVideo');
    const placeholder = document.querySelector('.ai-video-placeholder');
    const randomIndex = Math.floor(Math.random() * myAiVideos.length);
    videoEl.src = myAiVideos[randomIndex];
    placeholder.style.display = 'none';
    videoEl.style.display = 'block';
    videoEl.load();
    videoEl.play();
    showMessage(translations['video_generated'][currentLanguage], 'success');
}

function addMessageToLog(content, type) {
    const chatLog = document.getElementById('chatLog');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}`;
    const sanitizedContent = content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    messageDiv.innerHTML = sanitizedContent;
    chatLog.appendChild(messageDiv);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function handleChatInput(event) {
    if (event.key === 'Enter') {
        askChatbot();
    }
}

async function askChatbot() {
    const inputEl = document.getElementById('chatInput');
    const input = inputEl.value.trim();
    if (!input) return;
    addMessageToLog(input, 'user-msg');
    inputEl.value = '';
    inputEl.disabled = true;
    const typingIndicator = document.getElementById('typing-indicator');
    typingIndicator.style.display = 'flex';
    try {
        const mockResponse = {
            generated_text: "I'm a solar energy assistant. I can help you with information about solar panel installation, subsidies, and maintenance. How can I assist you today?"
        };

        await new Promise(resolve => setTimeout(resolve, 1000));

        const botReply = mockResponse.generated_text;
        addMessageToLog(botReply, 'bot-msg');
    } catch (error) {
        console.error("Chatbot Error:", error);
        addMessageToLog(translations['chatbot_error'][currentLanguage], 'bot-msg');
    } finally {
        typingIndicator.style.display = 'none';
        inputEl.disabled = false;
        inputEl.focus();
    }
}

const translations = {
    // Navigational & Static Text
    nav_home: { en: "Home", hi: "होम" },
    nav_dashboard: { en: "Mission Control", hi: "मिशन कंट्रोल" },
    nav_calculator: { en: "Calculator", hi: "कैलकुलेटर" },
    nav_chatbot: { en: "AI Chatbot", hi: "AI चैटबॉट" },
    nav_ai_explainer: { en: "Solar Analysis", hi: "सोलर विश्लेषण" },
    nav_ai_visual: { en: "Your Solar Vision", hi: "आपका सोलर विजन" },
    nav_ai_video: { en: "Installation Preview", hi: "इंस्टॉलेशन पूर्वावलोकन" },
    nav_help: { en: "Help", hi: "सहायता" },
    nav_contact: { en: "Contact", hi: "संपर्क" },
    login_welcome: { en: "Welcome! Please log in to continue.", hi: "स्वागत है! जारी रखने के लिए कृपया लॉग इन करें।" },
    login_btn: { en: "Login", hi: "लॉग इन करें" },
    home_title: { en: "Light up Your Future with Solar Energy!", hi: "सौर ऊर्जा से अपने भविष्य को रोशन करें!" },
    home_subtitle: { en: "Reduce your electricity bills, protect the environment, and move towards a self-reliant energy future. Our 'SOLAR FOR ALL' calculator and AI will guide you every step of the way.", hi: "अपने बिजली के बिल कम करें, पर्यावरण की रक्षा करें और आत्मनिर्भर ऊर्जा भविष्य की ओर बढ़ें। हमारा 'सोलर फॉर ऑल' कैलकुलेटर और AI हर कदम पर आपका मार्गदर्शन करेंगे।" },
    home_card1_title: { en: "Instant Calculation", hi: "तुरंत गणना" },
    home_card1_desc: { en: "Estimate your system size, cost, and savings in seconds.", hi: "सेकंडों में अपने सिस्टम का आकार, लागत और बचत का अनुमान लगाएं।" },
    home_card1_btn: { en: "Go to Calculator", hi: "कैलकुलेटर पर जाएं" },
    home_card2_title: { en: "AI Assistant", hi: "AI सहायक" },
    home_card2_desc: { en: "Ask our AI chatbot anything about solar technology, subsidies, and maintenance.", hi: "हमारे AI चैटबॉट से सौर प्रौद्योगिकी, सब्सिडी और रखरखाव के बारे में कुछ भी पूछें।" },
    home_card2_btn: { en: "Chat Now", hi: "अभी चैट करें" },
    home_card3_title: { en: "Your Solar Vision", hi: "आपका सोलर विजन" },
    home_card3_desc: { en: "Visualize your environmental impact with AI-generated reports and visuals.", hi: "AI-जनरेटेड रिपोर्ट और विज़ुअल के साथ अपने पर्यावरणीय प्रभाव की कल्पना करें।" },
    home_card3_btn: { en: "See Visual", hi: "विज़ुअल देखें" },
    home_card4_title: { en: "Community Impact", hi: "सामुदायिक प्रभाव" },
    home_card4_desc: { en: "See the real-time environmental impact of our solar guardians worldwide.", hi: "दुनिया भर में हमारे सौर संरक्षकों के वास्तविक समय के पर्यावरणीय प्रभाव को देखें।" },
    home_card4_btn: { en: "See Impact", hi: "प्रभाव देखें" },
    gallery_title: { en: "Explore the World of Solar Energy", hi: "सौर ऊर्जा की दुनिया का अन्वेषण करें" },
    gallery1_title: { en: "Rural Village with Solar Panels on Rooftops", hi: "छतों पर सौर पैनलों वाला ग्रामीण गाँव" },
    gallery1_desc: { en: "This image shows a village where individual homes are equipped with rooftop solar panels.", hi: "यह छवि एक गाँव को दिखाती है जहाँ अलग-अलग घरों में छत पर सौर पैनल लगे हुए हैं।" },
    gallery2_title: { en: "Village School with Solar Panels", hi: "सौर पैनलों वाला गाँव का स्कूल" },
    gallery2_desc: { en: "This image highlights a village school powered by solar energy, enabling lighting and computers for students.", hi: "यह छवि सौर ऊर्जा से चलने वाले एक गाँव के स्कूल को दर्शाती है, जो छात्रों के लिए रोशनी और कंप्यूटर को संभव बनाता है।" },
    gallery3_title: { en: "Agricultural Village with Solar-Powered Water Pump", hi: "सौर-संचालित जल पंप वाला कृषि गाँव" },
    gallery3_desc: { en: "This image shows a solar-powered pump irrigating fields, reducing reliance on fossil fuels.", hi: "यह छवि खेतों की सिंचाई करते हुए एक सौर-संचालित पंप को दिखाती है, जिससे जीवाश्म ईंधन पर निर्भरता कम होती है।" },
    gallery4_title: { en: "Night View of a Village Lit by Solar Streetlights", hi: "सौर स्ट्रीटलाइट्स से रोशन एक गाँव का रात का दृश्य" },
    gallery4_desc: { en: "Solar streetlights enhance safety and extend evening activities in villages after dark.", hi: "सौर स्ट्रीटलाइट्स सुरक्षा बढ़ाती हैं और अँधेरा होने के बाद गाँवों में शाम की गतिविधियों का विस्तार करती हैं।" },
    gallery5_title: { en: "Centralized Solar Mini-Grid in a Village", hi: "एक गाँव में केंद्रीकृत सौर मिनी-ग्रिड" },
    gallery5_desc: { en: "Here, a small solar farm powers a cluster of homes, providing reliable electricity to a community.", hi: "यहाँ, एक छोटा सौर फार्म घरों के एक समूह को बिजली देता है, जिससे एक समुदाय को विश्वसनीय बिजली मिलती है।" },
    dashboard_title: { en: "Mission Control: Community Impact", hi: "मिशन कंट्रोल: सामुदायिक प्रभाव" },
    dashboard_stat1_title: { en: "Collective CO₂ Saved", hi: "सामूहिक CO₂ की बचत" },
    dashboard_stat2_title: { en: "Guardians Joined", hi: "जुड़े हुए संरक्षक" },
    dashboard_stat3_title: { en: "Equivalent Trees Planted", hi: "लगाए गए पेड़ों के बराबर" },
    did_you_know_title: { en: "NASA Tech on Your Roof!", hi: "आपकी छत पर NASA तकनीक!" },
    did_you_know_desc: { en: "The highly efficient solar cell technology we use today was pioneered by NASA to power satellites and spacecraft. By installing solar, you're using space-age tech to protect Earth!", hi: "आज हम जिस अत्यधिक कुशल सौर सेल तकनीक का उपयोग करते हैं, उसकी शुरुआत NASA ने उपग्रहों और अंतरिक्ष यान को बिजली देने के लिए की थी। सौर ऊर्जा लगाकर, आप पृथ्वी की रक्षा के लिए अंतरिक्ष-युग की तकनीक का उपयोग कर रहे हैं!" },
    calc_title: { en: "Your Solar Calculator", hi: "आपका सोलर कैलकुलेटर" },
    chat_title: { en: "Ask Your Solar Bot 🤖", hi: "अपने सोलर बॉट से पूछें 🤖" },
    explainer_title: { en: "Solar Analysis", hi: "सोलर विश्लेषण" },
    visual_title: { en: "Your Solar Vision", hi: "आपका सोलर विजन" },
    video_title: { en: "Installation Preview", hi: "इंस्टॉलेशन पूर्वावलोकन" },
    help_title: { en: "Help Center", hi: "सहायता केंद्र" },
    contact_title: { en: "Contact Us", hi: "संपर्क" },
    footer_text: { en: "&copy; 2025 SOLAR FOR ALL.", hi: "&copy; 2025 सभी के लिए सौर।" },
    // Calculator & Result Translations
    invalid_input: { en: "Please enter valid positive numbers for bill, tariff, and cost.", hi: "कृपया बिल, टैरिफ और लागत के लिए वैध सकारात्मक संख्याएं दर्ज करें।" },
    system_size_adjusted_roof: { en: "System size adjusted to fit your roof area.", hi: "सिस्टम का आकार आपकी छत के क्षेत्रफल के अनुसार समायोजित किया गया है।" },
    system_size_adjusted_budget: { en: "System size adjusted to fit your budget.", hi: "सिस्टम का आकार आपके बजट के अनुसार समायोजित किया गया है।" },
    location_not_found: { en: "Location not found. Please enter a valid address.", hi: "स्थान नहीं मिला। कृपया एक वैध पता दर्ज करें।" },
    size_label: { en: "System Size", hi: "सिस्टम का आकार" },
    cost_label: { en: "Total Cost", hi: "कुल लागत" },
    savings_label: { en: "Monthly Savings", hi: "मासिक बचत" },
    payback_label: { en: "Payback", hi: "रिकवरी" },
    co2_label: { en: "CO₂ Saved", hi: "बचाई गई CO₂" },
    trees_label: { en: "Trees Equivalent", hi: "पेड़ों के बराबर" },
    monthly_payment_label: { en: "Monthly Payment (₹)", hi: "मासिक भुगतान (₹)" },
    pollution_remaining: { en: "Remaining AQI", hi: "शेष AQI" },
    pollution_reduced: { en: "AQI Reduced by Solar", hi: "सौर ऊर्जा से कम हुआ AQI" },
    aqi_label: { en: "Air Quality Index (AQI)", hi: "वायु गुणवत्ता सूचकांक (AQI)" },
    original_aqi: { en: "Original AQI", hi: "मूल AQI" },
    gamification_title: { en: "🚀 Your Mission Impact", hi: "🚀 आपके मिशन का प्रभाव" },
    gamification_rover: { en: "Your annual energy could power NASA's <strong>Perseverance Rover on Mars for {roverDays} days!</strong>", hi: "आपकी वार्षिक ऊर्जा नासा के <strong>पर्सिवरेंस रोवर को मंगल ग्रह पर {roverDays} दिनों तक चला सकती है!</strong>" },
    gamification_iss: { en: "It could also power the <strong>International Space Station for {issSeconds} seconds!</strong>", hi: "यह <strong>अंतर्राष्ट्रीय अंतरिक्ष स्टेशन को {issSeconds} सेकंड तक भी चला सकती है!</strong>" },
    gamification_button: { en: "Activate Solar Colonist Mode", hi: "सौर उपनिवेशक मोड सक्रिय करें" },
    colonist_error: { en: "Please calculate your Earth-based system first!", hi: "कृपया पहले अपने पृथ्वी-आधारित सिस्टम की गणना करें!" },
    subsidy_not_eligible_title: { en: "❌ Not Eligible for Subsidy", hi: "❌ सब्सिडी के लिए पात्र नहीं" },
    subsidy_not_eligible_desc: { en: "Your electricity bill is very low, which suggests solar energy might not be the most economical option for you right now.", hi: "आपका बिजली बिल बहुत कम है, जो दर्शाता है कि सौर ऊर्जा अभी आपके लिए सबसे किफायती विकल्प नहीं हो सकती है।" },
    subsidy_eligible_title: { en: "💰 Your Subsidy Potential", hi: "💰 आपकी सब्सिडी की संभावना" },
    subsidy_eligible_desc: { en: "Based on your details, you may be eligible for the <strong>{schemeName}</strong>.", hi: "आपके विवरण के आधार पर, आप <strong>{schemeName}</strong> के लिए पात्र हो सकते हैं।" },
    subsidy_amount: { en: "Estimated Subsidy Amount: <strong>₹{subsidyAmount}</strong>", hi: "अनुमानित सब्सिडी राशि: <strong>₹{subsidyAmount}</strong>" },
    subsidy_cost_after: { en: "Cost after subsidy: <strong>₹{finalCost}</strong>", hi: "सब्सिडी के बाद लागत: <strong>₹{finalCost}</strong>" },
    subsidy_loan_details: { en: "Your estimated <strong>{bankName}</strong> EMI is <strong>₹{monthlyEMI}/month</strong> for a period of {loanTenure} years.", hi: "आपकी अनुमानित <strong>{bankName}</strong> EMI {loanTenure} साल की अवधि के लिए <strong>₹{monthlyEMI}/महीना</strong> है।" },
    subsidy_disclaimer: { en: "This is an estimate. Final amount may vary. Apply on the official government portal.", hi: "यह एक अनुमान है। अंतिम राशि भिन्न हो सकती है। आधिकारिक सरकारी पोर्टल पर आवेदन करें।" },
    no_scheme_found: { en: "No specific scheme found", hi: "कोई विशेष योजना नहीं मिली" },
    up_scheme: { en: "UP Solar Rooftop Subsidy Scheme", hi: "यूपी सोलर रूफटॉप सब्सिडी योजना" },
    gujarat_scheme: { en: "Gujarat Solar Subsidy Scheme", hi: "गुजरात सोलर सब्सिडी योजना" },
    no_loan: { en: "No Loan", hi: "कोई ऋण नहीं" },
    visual_error: { en: "Please run a calculation first.", hi: "कृपया पहले एक गणना चलाएँ।" },
    visual_generated: { en: "AI visual generated!", hi: "AI विज़ुअल उत्पन्न हुआ!" },
    video_error: { en: "Please run a calculation first.", hi: "कृपया पहले एक गणना चलाएँ।" },
    video_generated: { en: "AI video generated!", hi: "AI वीडियो उत्पन्न हुआ!" },
    chatbot_error: { en: "Sorry, I am having trouble connecting. Please try again later.", hi: "क्षमा करें, मुझे कनेक्ट करने में समस्या हो रही है। कृपया बाद में पुनः प्रयास करें।" },
    // New Translations for messages
    message_sent_success: { en: "Message sent successfully!", hi: "संदेश सफलतापूर्वक भेजा गया!" },
    invalid_login: { en: "Invalid username or password.", hi: "अवैध उपयोगकर्ता नाम या पासवर्ड।" },
    calculating_solar: { en: "Calculating your solar potential...", hi: "आपकी सौर क्षमता की गणना की जा रही है..." },
    explainer_placeholder: { en: "Your generated script will appear here...", hi: "आपका जेनरेट किया गया स्क्रिप्ट यहाँ दिखाई देगा..." },
    explainer_generated_message: { en: "AI Solar Analysis Generated!", hi: "AI सौर विश्लेषण उत्पन्न हुआ!" },
    explainer_generate_first_message: { en: "Please run a calculation first to generate an AI explainer.", hi: "कृपया पहले एक गणना चलाएँ ताकि AI एक्सप्लेनर उत्पन्न हो सके।" },
    location_detecting: { en: "Attempting to auto-detect your location...", hi: "आपकी लोकेशन का स्वतः पता लगाने का प्रयास किया जा रहा है..." },
    location_gps_success: { en: "GPS location detected!", hi: "जीपीएस लोकेशन का पता चला!" },
    location_gps_fail: { en: "GPS location detected, but could not find address.", hi: "जीपीएस लोकेशन का पता चला, लेकिन पता नहीं मिल सका।" },
    location_detected_label: { en: "Detected Location", hi: "पता लगाया गया स्थान" },
    location_ip_try: { en: "GPS failed. Trying to find city via IP address...", hi: "जीपीएस विफल। आईपी एड्रेस के माध्यम से शहर खोजने का प्रयास किया जा रहा है..." },
    location_ip_success: { en: "Approximate location found: {city}", hi: "अनुमानित लोकेशन मिली: {city}" },
    location_approximate_label: { en: "Approximate location: {city}", hi: "अनुमानित स्थान: {city}" },
    location_autodetect_fail: { en: "Automatic location detection failed.", hi: "स्वचालित लोकेशन का पता लगाना विफल रहा।" },
    location_not_supported: { en: "Geolocation is not supported by your browser.", hi: "आपके ब्राउज़र द्वारा जियोलोकेशन समर्थित नहीं है।" },
    location_prompt: { en: "Please enter an address or enable location services.", hi: "कृपया एक पता दर्ज करें या लोकेशन सेवाएँ सक्षम करें।" },
    location_address_not_found: { en: "Could not find location from entered address.", hi: "दर्ज किए गए पते से लोकेशन नहीं मिल सका।" },
    nasa_fetching: { en: "Fetching data from NASA...", hi: "नासा से डेटा प्राप्त किया जा रहा है..." },
    nasa_unavailable: { en: "⚠️ NASA data unavailable. Using estimate (4.5 kWh).", hi: "⚠️ नासा डेटा उपलब्ध नहीं है। अनुमान का उपयोग किया जा रहा है (4.5 kWh)।" },
    reset_message: { en: "Form has been reset.", hi: "फॉर्म रीसेट हो गया है।" },
    aqi_good: { en: "Good", hi: "अच्छा" },
    aqi_moderate: { en: "Moderate", hi: "मध्यम" },
    aqi_unhealthy: { en: "Unhealthy", hi: "अस्वास्थ्यकर" },
    aqi_city: { en: "City", hi: "शहर" },
};

function changeLanguage(lang) {
    currentLanguage = lang;
    document.querySelectorAll('[data-lang-key]').forEach(element => {
        const key = element.getAttribute('data-lang-key');
        if (translations[key] && translations[key][lang]) {
            let text = translations[key][lang];
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = text;
            } else {
                element.innerHTML = text;
            }
        }
    });

    if (lastCalc) {
        // Update dynamic content that depends on calculations
        displayResults(lastCalc);
        displaySubsidyResults(lastCalc.subsidyInfo, parseFloat(lastCalc.installCost), lastCalc.loanInfo);
        updateGamificationResults(lastCalc);
        displayAqiResults(lastCalc.aqiData);
        if (document.querySelector('#ai-explainer').classList.contains('active')) {
            generateAI();
        }
    }
}