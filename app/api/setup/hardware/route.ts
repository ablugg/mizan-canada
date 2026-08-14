import { NextResponse } from "next/server";
import os from "os";

export async function GET() {
  const totalRam = os.totalmem();
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : "Unknown";
  const cpuCores = cpus.length;
  const platform = os.platform();
  const arch = os.arch();

  return NextResponse.json({ totalRam, cpuModel, cpuCores, platform, arch });
}
