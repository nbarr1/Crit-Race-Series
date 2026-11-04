import { execFileSync } from "node:child_process";

export default function globalSetup() {
  execFileSync("bash", ["scripts/e2e-db.sh"], { stdio: "inherit", env: process.env });
}
