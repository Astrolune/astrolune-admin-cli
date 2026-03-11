import readline from "node:readline/promises";
import process from "node:process";

export async function promptInput(message: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return (await rl.question(`${message} `)).trim();
  } finally {
    rl.close();
  }
}
