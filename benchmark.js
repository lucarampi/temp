#!/usr/bin/env node

// benchmark.js

import { spawn, execSync } from 'child_process';
import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import readline from 'readline';

const SCRIPT_VERSION = '2.1.0'; // Updated version

// --- Dependency Management ---

/**
 * Checks for required packages and prompts to install them if missing.
 */
const checkAndInstallDependencies = async () => {
    const requiredPackages = ['inquirer', 'sharp'];
    const missingPackages = [];

    for (const pkg of requiredPackages) {
        try {
            // A trick to check if a module is available without importing it everywhere
            await import(pkg);
        } catch (err) {
            if (err.code === 'ERR_MODULE_NOT_FOUND') {
                missingPackages.push(pkg);
            }
        }
    }

    if (missingPackages.length > 0) {
        console.log('This script requires some additional packages to run.');
        console.log(`Missing: ${missingPackages.join(', ')}`);

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const answer = await new Promise(resolve => {
            rl.question('Would you like to install them now? (y/n) ', resolve);
        });

        rl.close();

        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
            console.log(`\nInstalling ${missingPackages.join(' ')}...`);
            try {
                // Using execSync for simplicity as this is a one-off setup command.
                execSync(`npm install ${missingPackages.join(' ')}`, { stdio: 'inherit' });
                console.log('\n✅ Dependencies installed successfully!');
                console.log('Please run the benchmark script again.');
                process.exit(0);
            } catch (err) {
                console.error('\n❌ Failed to install dependencies.');
                console.error('Please try installing them manually by running:');
                console.error(`npm install ${missingPackages.join(' ')}`);
                process.exit(1);
            }
        } else {
            console.log('Installation cancelled. Exiting.');
            process.exit(1);
        }
    }
};


// --- Helper Functions ---

/**
 * Checks if a directory exists.
 * @param {string} dirPath - The path to the directory.
 * @returns {Promise<boolean>}
 */
const directoryExists = async (dirPath) => {
    try {
        await fs.access(dirPath);
        return true;
    } catch {
        return false;
    }
};


/**
 * Gets the current average CPU usage.
 * @returns {number} Average CPU load percentage.
 */
const getCpuUsage = () => {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    }
    // Calculate the average usage as a percentage
    const avgIdle = totalIdle / cpus.length;
    const avgTotal = totalTick / cpus.length;
    return 100 * (1 - avgIdle / avgTotal);
};

/**
 * Gets the current memory usage.
 * @returns {{total: number, free: number, used: number, usedPercent: number}} Memory statistics in MB.
 */
const getMemoryUsage = () => {
    const totalMem = os.totalmem() / (1024 * 1024); // in MB
    const freeMem = os.freemem() / (1024 * 1024); // in MB
    const usedMem = totalMem - freeMem;
    const usedPercent = (usedMem / totalMem) * 100;
    return {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usedPercent: parseFloat(usedPercent.toFixed(2)),
    };
};

/**
 * A utility to run a command and measure its performance.
 * @param {string} command - The command to execute (e.g., 'npm', 'npx').
 * @param {string[]} args - The arguments for the command.
 * @param {object} [options={}] - Options for the child process.
 * @param {string} [killSignal] - A string to look for in stdout to kill the process.
 * @returns {Promise<object>} An object with the performance results.
 */
const measurePerformance = (command, args, options = {}, killSignal = null) => {
    return new Promise((resolve, reject) => {
        console.log(`\n🚀 Starting test: ${command} ${args.join(' ')}...`);

        const startMem = getMemoryUsage();
        const startCpu = getCpuUsage();
        const startTime = performance.now();

        const child = spawn(command, args, { shell: true, ...options });

        let output = '';
        let killed = false; // Flag to prevent multiple kill calls

        const handleOutput = (data) => {
            const dataStr = data.toString();
            output += dataStr;
            process.stdout.write(dataStr); // Show real-time output
            if (killSignal && !killed && output.includes(killSignal)) {
                killed = true; // Set flag
                console.log(`\n✅ Detected start signal. Terminating process...`);
                child.kill('SIGTERM');
            }
        };

        child.stdout.on('data', handleOutput);
        child.stderr.on('data', handleOutput); // Check stderr as well

        child.on('close', (code) => {
            const endTime = performance.now();
            const endMem = getMemoryUsage();
            const endCpu = getCpuUsage();

            if (code !== 0 && code !== null) { // null when process is killed intentionally
                 console.error(`\n❌ Test finished with error (code ${code}).`);
            } else {
                 console.log(`\n✅ Test finished.`);
            }

            resolve({
                command: `${command} ${args.join(' ')}`,
                duration_ms: endTime - startTime,
                duration_s: parseFloat(((endTime - startTime) / 1000).toFixed(2)),
                startMemory_MB: startMem.used,
                endMemory_MB: endMem.used,
                memoryUsage_MB: parseFloat((endMem.used - startMem.used).toFixed(2)),
                startCpu_percent: parseFloat(startCpu.toFixed(2)),
                endCpu_percent: parseFloat(endCpu.toFixed(2)),
                exitCode: code,
                output,
            });
        });

        child.on('error', (err) => {
            console.error(`\n❌ Failed to start subprocess.`);
            reject(err);
        });
    });
};

// --- Benchmark Tasks ---

const runCleanInstall = async (useLegacyPeerDeps) => {
    console.log('\n🚀 Starting test: Clean Install (deleting node_modules and running npm install)...');
    const totalStartTime = performance.now();
    const startMem = getMemoryUsage();
    const startCpu = getCpuUsage();

    let nodeModulesDeletionDuration = 0;
    let nextFolderDeletionDuration = 0;

    // --- Deletion Phase ---
    if (await directoryExists('node_modules')) {
        console.log('Verifying: `node_modules` folder found. Deleting...');
        const delNodeModulesStart = performance.now();
        await fs.rm('node_modules', { recursive: true, force: true });
        const delNodeModulesEnd = performance.now();
        nodeModulesDeletionDuration = parseFloat(((delNodeModulesEnd - delNodeModulesStart) / 1000).toFixed(2));
        console.log(`✅ Deleting node_modules took ${nodeModulesDeletionDuration}s.`);
    } else {
        console.log('Verifying: `node_modules` folder not found. Skipping deletion.');
    }

    if (await directoryExists('.next')) {
        console.log('Verifying: `.next` folder found. Deleting...');
        const delNextStart = performance.now();
        await fs.rm('.next', { recursive: true, force: true });
        const delNextEnd = performance.now();
        nextFolderDeletionDuration = parseFloat(((delNextEnd - delNextStart) / 1000).toFixed(2));
        console.log(`✅ Deleting .next took ${nextFolderDeletionDuration}s.`);
    } else {
        console.log('Verifying: `.next` folder not found. Skipping deletion.');
    }

    // --- Cache Cleaning Phase ---
    console.log('Cleaning npm cache...');
    const cacheCleanResult = await measurePerformance('npm', ['cache', 'clean', '--force']);
    const npmCacheCleanDuration = cacheCleanResult.duration_s;
    console.log(`✅ npm cache clean took ${npmCacheCleanDuration}s.`);

    // --- Installation Phase ---
    const installArgs = ['install'];
    if (useLegacyPeerDeps) {
        installArgs.push('--legacy-peer-deps');
    }
    const installResult = await measurePerformance('npm', installArgs);
    
    const totalEndTime = performance.now();
    const endMem = getMemoryUsage();
    const endCpu = getCpuUsage();

    return {
        command: 'Clean Install (cache, folders, install)',
        duration_ms: totalEndTime - totalStartTime,
        duration_s: parseFloat(((totalEndTime - totalStartTime) / 1000).toFixed(2)),
        startMemory_MB: startMem.used,
        endMemory_MB: endMem.used,
        memoryUsage_MB: parseFloat((endMem.used - startMem.used).toFixed(2)),
        startCpu_percent: parseFloat(startCpu.toFixed(2)),
        endCpu_percent: parseFloat(endCpu.toFixed(2)),
        subTasks: {
            deleteNodeModules: {
                duration_s: nodeModulesDeletionDuration,
            },
            deleteNextFolder: {
                duration_s: nextFolderDeletionDuration,
            },
            npmCacheClean: {
                duration_s: npmCacheCleanDuration,
            },
            npmInstall: {
                duration_s: installResult.duration_s,
            }
        }
    };
};

const runFileIoTest = async (runTempDir) => {
    console.log('\n🚀 Starting test: File I/O (Create & Delete 10000 files)...');
    const totalStartTime = performance.now();
    const startMem = getMemoryUsage();
    const startCpu = getCpuUsage();
    
    const tempDir = path.join(runTempDir, 'temp_files');
    const fileCount = 10000;
    const fileContent = 'a'.repeat(10000);
    
    // --- File Creation ---
    console.log(`Creating ${fileCount} files in ./${tempDir}...`);
    const createStart = performance.now();
    await fs.mkdir(tempDir, { recursive: true });

    // Batch file writing to avoid EMFILE error
    const chunkSize = 500;
    for (let i = 0; i < fileCount; i += chunkSize) {
        const chunkPromises = [];
        for (let j = i; j < i + chunkSize && j < fileCount; j++) {
            chunkPromises.push(fs.writeFile(path.join(tempDir, `file-${j}.txt`), fileContent));
        }
        await Promise.all(chunkPromises);
    }

    const createEnd = performance.now();
    const createDuration = parseFloat(((createEnd - createStart) / 1000).toFixed(2));
    console.log(`✅ File creation took ${createDuration}s.`);

    // --- File Deletion ---
    console.log(`Deleting ${fileCount} files...`);
    const deleteStart = performance.now();
    await fs.rm(tempDir, { recursive: true, force: true });
    const deleteEnd = performance.now();
    const deleteDuration = parseFloat(((deleteEnd - deleteStart) / 1000).toFixed(2));
    console.log(`✅ File deletion took ${deleteDuration}s.`);

    const totalEndTime = performance.now();
    const endMem = getMemoryUsage();
    const endCpu = getCpuUsage();

    return {
        command: `File I/O`,
        amountOfProcessedItems: fileCount,
        duration_ms: totalEndTime - totalStartTime,
        duration_s: parseFloat(((totalEndTime - totalStartTime) / 1000).toFixed(2)),
        startMemory_MB: startMem.used,
        endMemory_MB: endMem.used,
        memoryUsage_MB: parseFloat((endMem.used - startMem.used).toFixed(2)),
        startCpu_percent: parseFloat(startCpu.toFixed(2)),
        endCpu_percent: parseFloat(endCpu.toFixed(2)),
        subTasks: {
            createFiles: { duration_s: createDuration },
            deleteFiles: { duration_s: deleteDuration }
        }
    };
};

const runHeavyScript = async () => {
    console.log('\n🚀 Starting test: Heavy Node.js Script (in-process)...');
    const totalStartTime = performance.now();
    const startMem = getMemoryUsage();
    const startCpu = getCpuUsage();

    // --- Prime number calculation logic ---
    console.log('Starting heavy computation (prime number calculation)...');

    function isPrime(num) {
      if (num <= 1) return false;
      if (num <= 3) return true;
      if (num % 2 === 0 || num % 3 === 0) return false;
      for (let i = 5; i * i <= num; i = i + 6) {
        if (num % i === 0 || num % (i + 2) === 0) return false;
      }
      return true;
    }

    function findPrimes(max) {
      const primes = [];
      for (let i = 2; i <= max; i++) {
        if (isPrime(i)) {
          primes.push(i);
        }
      }
      return primes;
    }

    const maxNumber = 1000000;
    const primesFound = findPrimes(maxNumber);
    console.log(`Found ${primesFound.length} prime numbers up to ${maxNumber}.`);
    // --- End of logic ---

    const totalEndTime = performance.now();
    const endMem = getMemoryUsage();
    const endCpu = getCpuUsage();

    console.log(`✅ Heavy script finished.`);

    return {
        command: 'Heavy Node.js Script (in-process prime calculation)',
        duration_ms: totalEndTime - totalStartTime,
        duration_s: parseFloat(((totalEndTime - totalStartTime) / 1000).toFixed(2)),
        startMemory_MB: startMem.used,
        endMemory_MB: endMem.used,
        memoryUsage_MB: parseFloat((endMem.used - startMem.used).toFixed(2)),
        startCpu_percent: parseFloat(startCpu.toFixed(2)),
        endCpu_percent: parseFloat(endCpu.toFixed(2)),
    };
};

const runImageProcessingTest = async (sharp, runTempDir) => {
    console.log('\n🚀 Starting test: Image Processing (sharp)...');
    const totalStartTime = performance.now();
    const startMem = getMemoryUsage();
    const startCpu = getCpuUsage();
    
    const tempDir = path.join(runTempDir, 'temp_images');
    const imageCount = 200;
    const imageSize = { width: 2048, height: 2048 };
    const resizeWidth = 800;

    // --- Image Creation ---
    console.log(`Generating ${imageCount} sample images...`);
    const createStart = performance.now();
    await fs.mkdir(tempDir, { recursive: true });
    const createPromises = [];
    for (let i = 0; i < imageCount; i++) {
        const promise = sharp({
            create: {
                width: imageSize.width,
                height: imageSize.height,
                channels: 4,
                background: { r: i * 1, g: 255 - (i * 1), b: 128, alpha: 1 }
            }
        }).jpeg().toFile(path.join(tempDir, `image-${i}.jpg`));
        createPromises.push(promise);
    }
    await Promise.all(createPromises);
    const createEnd = performance.now();
    const createDuration = parseFloat(((createEnd - createStart) / 1000).toFixed(2));
    console.log(`✅ Sample image generation took ${createDuration}s.`);

    // --- Image Processing ---
    console.log(`Resizing ${imageCount} images...`);
    const processStart = performance.now();
    const processPromises = [];
    for (let i = 0; i < imageCount; i++) {
        const promise = sharp(path.join(tempDir, `image-${i}.jpg`))
            .resize(resizeWidth)
            .toFile(path.join(tempDir, `image-${i}-resized.jpg`));
        processPromises.push(promise);
    }
    await Promise.all(processPromises);
    const processEnd = performance.now();
    const processDuration = parseFloat(((processEnd - processStart) / 1000).toFixed(2));
    console.log(`✅ Image resizing took ${processDuration}s.`);

    // --- Cleanup is handled by the main loop ---

    const totalEndTime = performance.now();
    const endMem = getMemoryUsage();
    const endCpu = getCpuUsage();

    return {
        command: `Image Processing`,
        amountOfProcessedItems: imageCount,
        duration_ms: totalEndTime - totalStartTime,
        duration_s: parseFloat(((totalEndTime - totalStartTime) / 1000).toFixed(2)),
        startMemory_MB: startMem.used,
        endMemory_MB: endMem.used,
        memoryUsage_MB: parseFloat((endMem.used - startMem.used).toFixed(2)),
        startCpu_percent: parseFloat(startCpu.toFixed(2)),
        endCpu_percent: parseFloat(endCpu.toFixed(2)),
        subTasks: {
            generateImages: { duration_s: createDuration },
            resizeImages: { duration_s: processDuration }
        }
    };
};

const runTypeScriptCheck = () => measurePerformance('npx', ['tsc', '--noEmit']);
const runNextBuild = async () => {
    console.log('\n🚀 Starting test: Clean Production Build (next build)...');
    if (await directoryExists('.next')) {
        console.log('Verifying: `.next` folder found. Deleting for a clean build...');
        await fs.rm('.next', { recursive: true, force: true });
    } else {
        console.log('Verifying: `.next` folder not found. Proceeding with clean build.');
    }
    return measurePerformance('npx', ['next', 'build']);
};

const runLinterTest = () => measurePerformance('npx', ['next', 'lint']);

// --- Main Execution ---

const main = async () => {
    // Dynamically import dependencies after they have been verified
    const { default: inquirer } = await import('inquirer');
    const { default: sharp } = await import('sharp');

    console.log('=======================================');
    console.log('  Frontend Developer Benchmark Suite');
    console.log(`              v${SCRIPT_VERSION}`);
    console.log('=======================================');
    console.log('This script will measure the performance of common development tasks.');

    const { testsToRun } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'testsToRun',
            message: 'Select the benchmarks you want to run:',
            choices: [
                { name: 'Clean Install (cache, folders, install)', value: 'cleanInstall', checked: true },
                { name: 'Clean Production Build (next build)', value: 'nextBuild', checked: true },
                { name: 'TypeScript Type Check (tsc)', value: 'typeCheck', checked: true },
                { name: 'Linter (next lint)', value: 'linter', checked: true },
                { name: 'Image Processing (sharp)', value: 'imageProcessing', checked: true },
                { name: 'File I/O (Create & Delete 10000 files)', value: 'fileIo', checked: true },
                { name: 'Heavy Node.js Script Execution', value: 'heavyScript', checked: true },
            ],
            validate: (answer) => answer.length > 0 ? true : 'You must select at least one test to run.'
        }
    ]);

    const { useLegacyPeerDeps } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'useLegacyPeerDeps',
            message: 'Use --legacy-peer-deps for npm install?',
            default: false
        }
    ]);

    const { runCount } = await inquirer.prompt([
        {
            type: 'number',
            name: 'runCount',
            message: 'How many times should the test suite be run?',
            default: 3,
            validate: (input) => {
                if (input < 1) {
                    return 'Please enter a number of 1 or greater.';
                }
                return true;
            }
        }
    ]);

    const mainDir = 'benchmark-me';
    const resultsDir = path.join(mainDir, 'results');
    await fs.mkdir(resultsDir, { recursive: true });

    for (let i = 1; i <= runCount; i++) {
        const runTimestamp = Date.now();
        const runTempDir = path.join(mainDir, `temp-${runTimestamp}`);
        await fs.mkdir(runTempDir, { recursive: true });

        console.log(`\n\n=======================================`);
        console.log(`          Starting Run ${i} of ${runCount}`);
        console.log(`   (Temp files in ./${runTempDir})`);
        console.log(`=======================================\n`);
        
        const runStartTimeUTC = new Date().toISOString();

        const results = {
            scriptVersion: SCRIPT_VERSION,
            systemInfo: {
                hostname: os.hostname(),
                platform: os.platform(),
                arch: os.arch(),
                cpuModel: os.cpus()[0].model,
                cpuCores: os.cpus().length,
                totalMemory_MB: parseFloat((os.totalmem() / (1024 * 1024)).toFixed(2)),
            },
            benchmarks: {},
            runNumber: i,
            totalRuns: runCount,
            runStartTimeUTC: runStartTimeUTC,
            runEndTimeUTC: '',
        };

        if (testsToRun.includes('cleanInstall')) {
            results.benchmarks.cleanInstall = await runCleanInstall(useLegacyPeerDeps);
        }
        if (testsToRun.includes('nextBuild')) {
            if (!testsToRun.includes('cleanInstall')) {
                const { confirmInstall } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirmInstall',
                    message: 'The "next build" test requires node_modules to be installed. Run "npm install" first?',
                    default: true
                }]);
                if (confirmInstall) {
                    const installArgs = ['install'];
                    if (useLegacyPeerDeps) {
                        installArgs.push('--legacy-peer-deps');
                    }
                    await measurePerformance('npm', installArgs);
                }
            }
            results.benchmarks.nextBuild = await runNextBuild();
        }
         if (testsToRun.includes('typeCheck')) {
            results.benchmarks.typeCheck = await runTypeScriptCheck();
        }
         if (testsToRun.includes('linter')) {
            results.benchmarks.linter = await runLinterTest();
        }
        if (testsToRun.includes('imageProcessing')) {
            results.benchmarks.imageProcessing = await runImageProcessingTest(sharp, runTempDir);
        }
        if (testsToRun.includes('fileIo')) {
            results.benchmarks.fileIo = await runFileIoTest(runTempDir);
        }
        if (testsToRun.includes('heavyScript')) {
            results.benchmarks.heavyScript = await runHeavyScript();
        }

        results.runEndTimeUTC = new Date().toISOString();

        // Save results for the current run
        const resultsFilename = `benchmark-results-${os.hostname()}-${runTimestamp}.json`;
        const resultsPath = path.join(resultsDir, resultsFilename);
        await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));

        // Cleanup temp directory for the run
        await fs.rm(runTempDir, { recursive: true, force: true });

        console.log('\n---------------------------------------');
        console.log(`          Run ${i} Complete`);
        console.log('---------------------------------------');
        console.log(`\n📊 Results for this run saved to ${resultsPath}`);
        console.log('\nSummary for this run:');

        for (const testName in results.benchmarks) {
            const testResult = results.benchmarks[testName];
            const items = testResult.amountOfProcessedItems ? ` (${testResult.amountOfProcessedItems} items)` : '';
            if (testResult.subTasks) {
                console.log(`  - ${testResult.command}${items} (Total): ${testResult.duration_s}s`);
                for(const subTaskName in testResult.subTasks) {
                    const subTaskResult = testResult.subTasks[subTaskName];
                    const subTaskLabel = subTaskName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    console.log(`    - ${subTaskLabel}: ${subTaskResult.duration_s}s`);
                }
            }
            else {
                 console.log(`  - ${testResult.command}${items}: ${testResult.duration_s}s`);
            }
        }
    }

    console.log('\n=======================================');
    console.log('          All Benchmark Runs Complete');
    console.log('=======================================');
};

// Script entry point
(async () => {
    await checkAndInstallDependencies();
    await main();
})().catch(console.error);
