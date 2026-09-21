const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

async function ingestHimCodingWorklist(page) {
  try {
    // =====================================================
    // 1. Navigate to HIM Coding List
    // =====================================================

    const url =
      'https://pinev.connect.evident.com/?facid=1&op=launch_him_coding_list/him-group/coding_list_screen';

    console.log('');
    console.log('========================================');
    console.log('HIM CODING WORKLIST');
    console.log('========================================');
    console.log('Opening:', url);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    console.log('HIM Coding List page loaded.');

    // Give the application time to render
    await page.waitForTimeout(5000);

    // =====================================================
    // 2. Find CSV button
    // =====================================================

    console.log('Looking for CSV button...');

    const csvButton = page.locator('cpsi-button[title="CSV"]').filter({ hasText: 'CSV' }).first();

    await csvButton.waitFor({
      state: 'visible',
      timeout: 120000,
    });

    console.log('CSV button found.');

    // =====================================================
    // 3. Click CSV and capture download
    // =====================================================

    console.log('Clicking CSV...');

    const downloadPromise = page.waitForEvent('download', {
      timeout: 120000,
    });

    await csvButton.click();

    await page.waitForTimeout(10 * 1000);

    const download = await downloadPromise;

    console.log('CSV download completed.');

    // =====================================================
    // 4. Get downloaded file information
    // =====================================================

    const suggestedFileName = download.suggestedFilename();

    console.log('Downloaded file:', suggestedFileName);

    // =====================================================
    // 5. Destination folder
    // =====================================================

    const destinationFolder = 'C:\\Users\\Administrator\\Documents\\HimCodeFile';

    // Make sure destination folder exists
    fs.mkdirSync(destinationFolder, {
      recursive: true,
    });

    const destinationPath = path.join(destinationFolder, suggestedFileName);

    console.log('Moving file to:');
    console.log(destinationPath);

    // =====================================================
    // 6. Move downloaded file
    // =====================================================

    await download.saveAs(destinationPath);

    console.log('CSV file moved successfully.');

    // =====================================================
    // 7. Run Python script
    // =====================================================

    const pythonFolder = 'C:\\Users\\Administrator\\Documents\\python_files';

    const pythonFile = path.join(pythonFolder, 'ingest_him_coding_worklist.py');

    console.log('');
    console.log('Running Python script:');
    console.log(pythonFile);

    // =====================================================
    // 8. Execute Python main()
    // =====================================================

    await new Promise((resolve, reject) => {
      execFile(
        'python',
        [pythonFile],
        {
          cwd: pythonFolder,
          windowsHide: false,
        },
        (error, stdout, stderr) => {
          if (stdout) {
            console.log('');
            console.log('========== PYTHON OUTPUT ==========');
            console.log(stdout);
            console.log('===================================');
          }

          if (stderr) {
            console.log('');
            console.log('========== PYTHON STDERR ==========');
            console.log(stderr);
            console.log('===================================');
          }

          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    });

    console.log('');
    console.log('Python ingestion completed successfully.');

    console.log('');
    console.log('========================================');
    console.log('HIM CODING WORKLIST COMPLETED');
    console.log('========================================');

    return {
      fileName: suggestedFileName,
      filePath: destinationPath,
      pythonScript: pythonFile,
    };
  } catch (error) {
    console.error('');
    console.error('========================================');
    console.error('HIM CODING WORKLIST FAILED');
    console.error('========================================');
    console.error(error);

    throw error;
  }
}

module.exports = {
  ingestHimCodingWorklist,
};
