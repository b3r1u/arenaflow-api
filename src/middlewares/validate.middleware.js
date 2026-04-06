const { z } = require('zod');

/**
 * Retorna um middleware Express que valida req.body com o schema Zod fornecido.
 * Em caso de erro, responde 400 com a lista de campos inválidos.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Dados inválidos', details: errors });
    }

    req.body = result.data; // dados já validados e transformados
    next();
  };
}

module.exports = { validate };
