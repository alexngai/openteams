import readline from "readline";

export function askYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export function selectFromList(
  prompt: string,
  options: string[]
): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    console.log(prompt);
    for (let i = 0; i < options.length; i++) {
      console.log(`  ${i + 1}) ${options[i]}`);
    }

    rl.question("Select a number: ", (answer) => {
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolve(options[idx]);
      } else {
        reject(new Error("Invalid selection"));
      }
    });
  });
}
