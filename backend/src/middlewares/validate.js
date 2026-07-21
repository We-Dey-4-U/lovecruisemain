// backend/src/middlewares/validate.js
//
// Lightweight schema-based request validation using zod (small,
// fast, no code-gen step — fits a codebase that doesn't already
// have a validation library). Rejects malformed requests before
// they ever touch a controller or the database, which is both a
// security control (input validation, SQLi/XSS surface reduction)
// and a correctness control (no more "undefined" silently reaching
// a SQL query).
//
// Install: npm install zod
//
// Usage in a routes file:
//   const { validate } = require("../middlewares/validate");
//   const { z } = require("zod");
//
//   const sendGiftSchema = z.object({
//     body: z.object({
//       receiverId: z.string().uuid(),
//       giftId: z.string().uuid(),
//       quantity: z.number().int().min(1).max(999).optional(),
//       contextType: z.enum(["chat","call","live_room","podcast","profile","radio_broadcast"]),
//       contextId: z.string().uuid().nullable().optional(),
//     }),
//   });
//
//   router.post("/send", requireAuth, validate(sendGiftSchema), GiftController.send);

const { z } = require("zod");

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: issues,
      });
    }

    // Overwrite with parsed/coerced values (e.g. numeric strings ->
    // numbers) so controllers get clean, typed input.
    if (result.data.body) req.body = result.data.body;
    if (result.data.query) req.query = result.data.query;
    if (result.data.params) req.params = result.data.params;

    next();
  };
}

// Common reusable fragments
const schemas = {
  uuid: z.string().uuid(),
  pagination: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),
};

module.exports = { validate, schemas, z };