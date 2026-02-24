require("dotenv").config();
const mongoose = require("mongoose");
const Admin = require("../models/Admin.model");
const Facility = require("../models/Facility.model");
const { v4: uuidv4 } = require("uuid");

const seedDatabase = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("Connected to MongoDB");

    // Create default super admin if not exists
    const adminEmail = process.env.ADMIN_EMAIL;
    const existingAdmin = await Admin.findOne({ email: adminEmail });

    if (!existingAdmin) {
      const admin = await Admin.create({
        email: adminEmail,
        password: process.env.ADMIN_PASSWORD,
        name: "Super Admin",
        role: "super_admin",
      });

      console.log("Super admin created:");
      console.log(`Email: ${admin.email}`);
      console.log(`Password: ${process.env.ADMIN_PASSWORD}`);
      console.log("Please change the password after first login!");
    } else {
      console.log("Super admin already exists");
    }

    // Create sample facility
    const facilityCount = await Facility.countDocuments();

    if (facilityCount === 0) {
      const facility = await Facility.create({
        facilityId: uuidv4(),
        name: "Main Building",
        location: {
          address: "123 Main Street",
          city: "Indore",
          state: "Madhya Pradesh",
          country: "India",
        },
        description: "Main office building",
        status: "active",
      });

      console.log("Sample facility created:");
      console.log(`Name: ${facility.name}`);
      console.log(`ID: ${facility._id}`);
    } else {
      console.log("Facilities already exist");
    }

    console.log("Database seeding completed!");
    process.exit(0);
  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  }
};

seedDatabase();
