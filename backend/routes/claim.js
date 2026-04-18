const express = require("express");
const multer = require("multer");

const { processClaimRequest } = require("../controllers/claimController");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!file.mimetype.startsWith("image/")) {
      const error = new Error("Only image uploads are supported.");
      error.statusCode = 400;
      return callback(error);
    }

    return callback(null, true);
  },
});

router.post("/process-claim", upload.single("claimImage"), processClaimRequest);

module.exports = router;
