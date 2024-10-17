
const toggleButton = document.getElementById('toggleButton');             // Gets button toggle element
const noteDisplay = document.getElementById('noteDisplay');               // Gets note display element
const frequencyDisplay = document.getElementById('frequencyDisplay');     // Gets frequency display element
const needle = document.getElementById('needle');                         // Gets tuner needle element
const flatSharpIndicator = document.getElementById('flatSharpIndicator'); // Gets element that displays whether sound is flat, sharp, or in tune


let audioContext;        // Variable to hold audio context, for use in audio processing
let analyser;            // Variable for the analyser node, to process audio input and frequency analyse
let microphone;          // Variable to store mic input stream
let isListening = false; // Variable to track whether tuner is listening to mic

const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]; // Musical notes array

// -------------------- Smoothing variables

// Sets the buffer size to smooth frequency measurements over time
const frequencyBufferSize = 10;
let frequencyBuffer = [];

// Stores smoothed deviation (cents) between detected frequency and nearest semi-tone
let smoothedCents = 0;

// Sets buffer for note smoothing, prevents flickering between notes
let noteBufferSize = 5;
let noteBuffer = [];

// Adds an event listener, for click to toggle start and stop mic listening
toggleButton.addEventListener('click', toggleMicrophone);

/**
 * Function that starts or stops mic input based on the current listening state
 */
function toggleMicrophone() {
    if (isListening) {
        stopListening();
    } else {
        startListening();
    }
}

/**
 * Function that starts microphone listening after the mic access is allowed and audiostream = true
 */
async function startListening() {
    try {
        // Requests microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });
        // Sets up audio context, connects mic input to analyzer
        audioContext = new(window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        analyser.fftSize = 2048;
        // Updates button label, starts analyzing
        isListening = true;
        toggleButton.textContent = 'Stop Tuner';
        updatePitch();
        // Displays error if mic access fails
    } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Unable to access the microphone. Please check your permissions.');
    }
}

/**
 * Function that stops mic input, resets the displays and clears the buffers
 */
function stopListening() {
    if (audioContext) {
        audioContext.close();
    }
    isListening = false;
    toggleButton.textContent = 'Start Tuner';
    noteDisplay.textContent = '-';
    frequencyDisplay.textContent = '- Hz';
    flatSharpIndicator.textContent = '';
    setNeedle(0);
    frequencyBuffer = [];
    noteBuffer = [];
}

/**
 * Function to update the pitch 
 */
function updatePitch() {
    // Gets time-domain audio data for pitch analysis
    const bufferLength = analyser.fftSize;
    const buffer = new Float32Array(bufferLength);
    analyser.getFloatTimeDomainData(buffer);

    // Performs the auto correlation to detect the pitch
    const ac = autoCorrelate(buffer, audioContext.sampleRate);

    // Averages frequency buffer for a smoother reading
    if (ac !== -1 && isFinite(ac) && ac > 0) {
        // Apply moving average filter
        frequencyBuffer.push(ac);
        if (frequencyBuffer.length > frequencyBufferSize) {
            frequencyBuffer.shift();
        }
        const smoothedFrequency = frequencyBuffer.reduce((a, b) => a + b) / frequencyBuffer.length;

        // Calculates closest semi-tone and the pitch deviation (in cents)
        const note = noteFromPitch(smoothedFrequency);
        const noteName = noteStrings[note % 12];
        const cents = centsOffFromPitch(smoothedFrequency, note);

        // Smooth the cents for the needle to gradually move
        smoothedCents = smoothedCents * 0.8 + cents * 0.2;

        // Updates the frequency display
        frequencyDisplay.textContent = `${smoothedFrequency.toFixed(2)} Hz`;

        // Update note display with a smoothed note buffer
        noteBuffer.push(noteName);
        if (noteBuffer.length > noteBufferSize) {
            noteBuffer.shift();
        }
        const mostFrequentNote = findMostFrequent(noteBuffer);
        if (mostFrequentNote) {
            noteDisplay.textContent = mostFrequentNote;
        }

        // Adjusts the needle and indicators of flatness/sharpness based on the pitch accuracy
        setNeedle(smoothedCents);
        updateFlatSharpIndicator(smoothedCents);
    } else {
        // Clears the display if there is no pitch detected
        noteDisplay.textContent = '-';
        frequencyDisplay.textContent = '- Hz';
        flatSharpIndicator.textContent = '';
        setNeedle(0);
        frequencyBuffer = [];
        noteBuffer = [];
    }

    if (isListening) {
        // Repeatedly updates pitch detection whilst tuner is active
        requestAnimationFrame(updatePitch);
    }
}

/**
 * Function to find most frequent note within the buffer, to stabilise the note display
 */
function findMostFrequent(arr) {
    return arr.sort((a, b) =>
        arr.filter(v => v === a).length - arr.filter(v => v === b).length
    ).pop();
}

/**
 * Function to calculate the detected pitch frequency if there is a valid correlation
 */
function autoCorrelate(buffer, sampleRate) {
    const SIZE = buffer.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let bestOffset = -1;
    let bestCorrelation = 0;
    let rms = 0;
    let foundGoodCorrelation = false;

    for (let i = 0; i < SIZE; i++) {
        const val = buffer[i];
        rms += val * val;
    }
    // Calculates the root mean square (rms) to detect signal strength
    rms = Math.sqrt(rms / SIZE);

    // If the signal is too weak, return -1 (no pitch detected)
    if (rms < 0.01) {
        return -1;
    }

    let lastCorrelation = 1;
    for (let offset = 0; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;

        for (let i = 0; i < MAX_SAMPLES; i++) {
            correlation += Math.abs((buffer[i]) - (buffer[i + offset]));
        }

        // Calculates correlation between audio samples to detect pitch
        correlation = 1 - (correlation / MAX_SAMPLES);

        if (correlation > 0.9 && correlation > lastCorrelation) {
            foundGoodCorrelation = true;
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = offset;
            }
        } else if (foundGoodCorrelation) {
            let shift = (correlationShift(buffer, MAX_SAMPLES, offset) - 8) / 32;
            return sampleRate / (bestOffset + shift);
        }
        lastCorrelation = correlation;
    }

    if (bestCorrelation > 0.01) {
        return sampleRate / bestOffset;
    }
    // returns the detected pitch frequency if a valid correlation is found
    return -1;
}

/**
 * Function to fine tune the detected pitch offset, in order to more precisely calculate pitch
 */
function correlationShift(buffer, maxSamples, offset) {
    let best_offset = -1;
    let best_correlation = 0;
    let cc, cc_prev;

    for (let i = 0; i < 16; i++) {
        cc = 0;
        cc_prev = 0;
        for (let j = 0; j < maxSamples; j++) {
            cc += Math.abs(buffer[j] - buffer[j + offset + i]);
            cc_prev += Math.abs(buffer[j] - buffer[j + offset + i - 1]);
        }
        if (i === 0 || cc < best_correlation) {
            best_correlation = cc;
            best_offset = i;
        }
        if (cc > cc_prev) {
            break;
        }
    }
    return best_offset;
}

/**
 * Function to convert the frequency to the nearest MIDI note
 */
function noteFromPitch(frequency) {
    const noteNum = 12 * (Math.log(frequency / 440) / Math.log(2));
    return Math.round(noteNum) + 69;
}

/**
 * Function to convert a MIDI note back to its frequency
 */
function frequencyFromNoteNumber(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * Function to calculate how far (cents) the frequency detected is from the exact pitch
 */
function centsOffFromPitch(frequency, note) {
    return Math.floor(1200 * Math.log(frequency / frequencyFromNoteNumber(note)) / Math.log(2));
}

/**
 * Function to rotate the tuner needle using the cents deviation from the target pitch
 */
function setNeedle(cents) {
    const angle = Math.max(-45, Math.min(45, cents / 2));
    needle.style.transform = `rotate(${angle}deg)`;
}

/**
 * Function to update the indicators showing whether the frequency is flat or sharp of the 'perfect' note
 */
function updateFlatSharpIndicator(cents) {
    if (Math.abs(cents) < 5) {
        flatSharpIndicator.textContent = 'In tune';
        flatSharpIndicator.style.color = '#4CAF50';
    } else if (cents < 0) {
        flatSharpIndicator.textContent = 'Flat';
        flatSharpIndicator.style.color = '#2196F3';
    } else {
        flatSharpIndicator.textContent = 'Sharp';
        flatSharpIndicator.style.color = '#FF5722';
    }
}