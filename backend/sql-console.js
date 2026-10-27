require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const readline = require("readline");
const pool = require("./db");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "railflow-sql> " });
let buffer = "";
console.log("RailFlow SQL demo console connected to the database configured in backend/.env.");
console.log("Read-only mode: use SELECT, SHOW, DESCRIBE or EXPLAIN statements ending with a semicolon.");
console.log("Examples: SHOW TABLES;   SELECT * FROM bookings;   SELECT * FROM trains;");
console.log("Type exit to close the console.\n");
rl.prompt();

rl.on("line", async (line) => {
  const clean = line.trim();
  if (!buffer && ["exit", "quit"].includes(clean.toLowerCase())) {
    rl.close();
    return;
  }
  buffer += `${line}\n`;
  if (!buffer.trim().endsWith(";")) {
    rl.setPrompt("       -> ");
    rl.prompt();
    return;
  }
  const sql = buffer.trim().replace(/;\s*$/, "").trim();
  buffer = "";
  rl.setPrompt("railflow-sql> ");
  if (!/^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(sql)) {
    console.log("Only read-only SELECT/SHOW/DESCRIBE/EXPLAIN queries are allowed in this demo console.");
    rl.prompt();
    return;
  }
  try {
    const [rows] = await pool.query(sql);
    if (Array.isArray(rows)) {
      console.table(rows);
      console.log(`${rows.length} row(s) returned.\n`);
    } else {
      console.log(rows);
    }
  } catch (error) {
    console.error(`SQL error: ${error.message}\n`);
  }
  rl.prompt();
});

rl.on("close", async () => {
  await pool.end();
  console.log("Disconnected from RailFlow MySQL demo console.");
  process.exit(0);
});
