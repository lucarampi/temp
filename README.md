## Frontend Developer Benchmark Suite

A command-line tool to run a series of realistic benchmarks that simulate the daily tasks of a frontend developer. This suite helps quantify performance differences between machines, providing concrete data to justify hardware upgrades.

The tool runs multiple tests, including dependency installation, build times, code linting, image processing, and other CPU/IO‑intensive tasks. It generates detailed JSON reports for each run, which can be used with the companion comparison UI.

### Features
- Realistic Scenarios: Tests are based on real‑world frontend development tasks.
- Multiple Runs: Runs the entire test suite multiple times to ensure stable, reliable results.
- Detailed Reports: Generates a separate JSON file for each run with timestamps, system info, and performance metrics.
- Easy to Use: Interactive CLI for selecting tests and number of runs.

### Installation
```bash
npm install -g benchmark-me
```
This makes the `benchmark-me` command available in your terminal.

### How to Use
1. Navigate to the root of a Next.js project you want to test.
2. Run:
```bash
benchmark-me
```
Follow the prompts to select tests and the number of runs (default is 3). The script saves a `benchmark-results-....json` file for each run in your current directory.

### The Tests
- Clean Install: Cleans npm cache, deletes `node_modules` and `.next`, then runs `npm install`.
- Clean Production Build: Deletes `.next` and runs `npx next build`.
- TypeScript Type Check: Runs `npx tsc --noEmit`.
- Linter: Runs `npx next lint`.
- Image Processing: Programmatically generates and resizes 200 high‑resolution images using `sharp`.
- File I/O: Creates and deletes 10,000 text files.
- Heavy Node.js Script: Calculates a large number of prime numbers to stress the CPU.

### Compare Results
After running the benchmarks on two different machines, use the companion web UI to upload the result files and visually compare performance.