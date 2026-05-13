const { ZodError } = require("zod");

const validate = (schema) => (req, _res, next) => {
  try {
    const parsed = schema.parse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    req.body = parsed.body ?? req.body;
    req.params = parsed.params ?? req.params;
    req.query = parsed.query ?? req.query;
    next();
  } catch (error) {
    next(error);
  }
};

const isZodError = (error) => error instanceof ZodError;

module.exports = { validate, isZodError };
