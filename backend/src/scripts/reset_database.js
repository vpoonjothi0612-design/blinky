import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sequelize, { connectDatabase } from "../config/database.js";
import Auth from "../modules/auth/auth.model.js";
import Camera from "../modules/camera/camera.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

async function resetDatabase() {
  console.log("=================================================");
  console.log("  RESETTING FACETRACK DATABASE & CLEARING DATA   ");
  console.log("=================================================");

  try {
    await connectDatabase();

    console.log("[1/4] Truncating all database tables...");
    const tables = [
      "attendances",
      "face_enrollments",
      "employees",
      "leaves",
      "holidays",
      "shifts",
      "vehicles",
      "cameras",
      "users",
    ];

    for (const table of tables) {
      try {
        await sequelize.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`);
        console.log(`  ✓ Truncated table: ${table}`);
      } catch (err) {
        console.warn(`  ! Could not truncate ${table} directly: ${err.message}`);
      }
    }

    console.log("\n[2/4] Seeding clean Administrator user...");
    const hashedPassword = await bcrypt.hash("admin123", 10);
    const adminUser = await Auth.create({
      id: uuidv4(),
      name: "Administrator",
      email: "admin@gmail.com",
      password: hashedPassword,
      rawPassword: "admin123",
      role: "ADMIN",
      isActive: true,
    });
    console.log(`  ✓ Created Admin: ${adminUser.email} (Role: ${adminUser.role}, Password: admin123)`);

    console.log("\n[3/4] Seeding dual CP PLUS cameras...");
    const cam1 = await Camera.create({
      id: uuidv4(),
      name: "CAM-01 (Exit Gate)",
      location: "Exit Gate (OUT)",
      ipAddress: "192.168.15.56",
      rtspUrl: "rtsps://admin:Champ%403841@192.168.15.56:554/video/live?channel=1&subtype=1&unicast=true&proto=Onvif",
      status: "ACTIVE",
    });
    console.log(`  ✓ Registered: ${cam1.name} [${cam1.ipAddress}] -> OUT`);

    const cam2 = await Camera.create({
      id: uuidv4(),
      name: "CAM-02 (Entry Gate)",
      location: "Entry Gate (IN)",
      ipAddress: "192.168.15.57",
      rtspUrl: "rtsps://admin:Champ%403841@192.168.15.57:554/video/live?channel=1&subtype=1&unicast=true&proto=Onvif",
      status: "ACTIVE",
    });
    console.log(`  ✓ Registered: ${cam2.name} [${cam2.ipAddress}] -> IN`);

    console.log("\n[4/4] Cleaning temporary audit files and lockfiles in ai-services/data/...");
    const dataDir = path.join(PROJECT_ROOT, "ai-services/data");
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      let removedAudit = 0;
      for (const file of files) {
        if (file.startsWith("test_audit_") && file.endsWith(".db")) {
          fs.unlinkSync(path.join(dataDir, file));
          removedAudit++;
        }
        if (file.endsWith(".lock")) {
          fs.unlinkSync(path.join(dataDir, file));
        }
      }
      console.log(`  ✓ Removed ${removedAudit} test audit databases and stale lockfiles.`);

      // Reset outbox and employees json
      fs.writeFileSync(path.join(dataDir, "attendance_outbox.json"), "[]\n", "utf8");
      fs.writeFileSync(path.join(dataDir, "employees.json"), "[]\n", "utf8");
      if (fs.existsSync(path.join(dataDir, "attendance_events.db"))) {
        fs.unlinkSync(path.join(dataDir, "attendance_events.db"));
      }
      console.log("  ✓ Reset attendance outbox and employees.json cleanly.");
    }

    console.log("\n=================================================");
    console.log("  DATABASE RESET & CLEAN SETUP COMPLETE!         ");
    console.log("=================================================");
    console.log("Login Credentials:");
    console.log("  Email/Username : admin@gmail.com (or Administrator)");
    console.log("  Password       : admin123");
    console.log("  Role           : Admin");
    console.log("You and your team can also register new accounts");
    console.log("using the 'Create Account' tab on the login page.");
    console.log("=================================================");

    process.exit(0);
  } catch (error) {
    console.error("Database reset error:", error);
    process.exit(1);
  }
}

resetDatabase();
