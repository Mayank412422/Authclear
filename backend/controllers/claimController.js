const { processClaim } = require("../services/pipeline");

async function processClaimRequest(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Claim image is required.",
      });
    }

    const result = await processClaim({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  processClaimRequest,
};
