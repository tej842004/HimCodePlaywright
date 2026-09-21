const { spawn } = require("child_process");

function runPythonFunction(functionName, functionArguments) {
  return new Promise((resolve, reject) => {
    // -------------------------------------------------------
    // Python executable
    // -------------------------------------------------------

    const pythonExecutable =
      "C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python312\\python.exe";

    // -------------------------------------------------------
    // Python file
    // -------------------------------------------------------

    const pythonFile =
      "C:\\Users\\Administrator\\Documents\\python_files\\insert_patinet_information.py";

    // -------------------------------------------------------
    // Convert function arguments to JSON
    // -------------------------------------------------------

    const argumentsJson = JSON.stringify(functionArguments);

    console.log("");
    console.log("========================================");
    console.log("Calling Python");
    console.log("Function:", functionName);
    console.log("Arguments size:", argumentsJson.length, "characters");
    console.log("========================================");

    // -------------------------------------------------------
    // Start Python
    // -------------------------------------------------------

    const python = spawn(
      pythonExecutable,
      [pythonFile, "--function", functionName],
      {
        windowsHide: true,
      },
    );

    let output = "";
    let errorOutput = "";

    // -------------------------------------------------------
    // Python stdout
    // -------------------------------------------------------

    python.stdout.on("data", (data) => {
      output += data.toString();
    });

    // -------------------------------------------------------
    // Python stderr
    // -------------------------------------------------------

    python.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    // -------------------------------------------------------
    // Send arguments through stdin
    // -------------------------------------------------------

    try {
      python.stdin.write(argumentsJson);
      python.stdin.end();
    } catch (error) {
      reject(error);
      return;
    }

    // -------------------------------------------------------
    // Python finished
    // -------------------------------------------------------

    python.on("close", (code) => {
      console.log("Python exit code:", code);

      // -----------------------------------------------------
      // Python failed
      // -----------------------------------------------------

      if (code !== 0) {
        console.error("");
        console.error("========================================");
        console.error("PYTHON FAILED");
        console.error("Function:", functionName);
        console.error("Exit code:", code);
        console.error("========================================");

        console.error("");
        console.error("Python STDERR:");
        console.error(errorOutput || "(empty)");

        console.error("");
        console.error("Python STDOUT:");
        console.error(output || "(empty)");

        console.error("========================================");

        reject(new Error(`Python function failed: ${functionName}`));

        return;
      }

      // -----------------------------------------------------
      // Python succeeded
      // -----------------------------------------------------

      try {
        const trimmedOutput = output.trim();

        if (!trimmedOutput) {
          throw new Error("Python returned empty output");
        }

        const result = JSON.parse(trimmedOutput);

        resolve(result);
      } catch (error) {
        console.error("");
        console.error("========================================");
        console.error("COULD NOT PARSE PYTHON OUTPUT");
        console.error("========================================");

        console.error(output);

        console.error("========================================");

        reject(error);
      }
    });

    // -------------------------------------------------------
    // Python couldn't start
    // -------------------------------------------------------

    python.on("error", (error) => {
      console.error("");
      console.error("========================================");
      console.error("FAILED TO START PYTHON");
      console.error("========================================");

      console.error(error);

      reject(error);
    });
  });
}

module.exports = {
  runPythonFunction,
};
