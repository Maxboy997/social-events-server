import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("/api/auth/jwks", process.env.CLIENT_URL)
);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());


export async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (err) {
    console.error("JWT verify failed:", err.message);
    res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/events", verifyToken, async (req, res) => {
  try {
    const { title, description, eventType, thumbnail, location, eventDate } = req.body;

    if (!title || !description || !eventType || !thumbnail || !location || !eventDate) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const date = new Date(eventDate);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (isNaN(date) || date < startOfToday) {
      return res.status(400).json({ error: "Event date must be today or later" });
    }

    const result = await db.collection("events").insertOne({
      title,
      description,
      eventType,
      thumbnail,
      location,
      eventDate: date,
      createdBy: req.user.email,
      createdAt: new Date(),
    });

    res.status(201).json({ id: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create event" });
  }
});

const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectDB() {
  await client.connect();
  db = client.db("socialEvents");
  console.log("Connected to MongoDB");
}

app.get("/events", async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const events = await db
      .collection("events")
      .find({ eventDate: { $gte: startOfToday } })
      .sort({ eventDate: 1 })
      .toArray();

    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load events" });
  }
});

app.get("/", (req, res) => {
  res.send("Social events server is running");
});

app.get("/events/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid event id" });
    }

    const event = await db.collection("events").findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json(event);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load event" });
  }
});

app.post("/events/:id/join", verifyToken, async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid event id" });
    }

    const eventId = new ObjectId(req.params.id);
    const event = await db.collection("events").findOne({ _id: eventId });

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const joins = db.collection("joins");
    const alreadyJoined = await joins.findOne({
      eventId,
      userEmail: req.user.email,
    });

    if (alreadyJoined) {
      return res.status(409).json({ error: "You already joined this event" });
    }

    await joins.insertOne({
      eventId,
      userEmail: req.user.email,
      joinedAt: new Date(),
    });

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not join event" });
  }
});

connectDB()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Could not connect to MongoDB", err);
  });