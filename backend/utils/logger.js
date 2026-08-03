function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code || null,
    stack: error.stack || null,
  };
}

function log(level, event, context = {}, error = null) {
  const payload = {
    timestamp: new Date().toISOString(),
    service: "authclear-backend",
    level,
    event,
    context,
    error: serializeError(error),
  };

  const message = JSON.stringify(payload);

  if (level === "ERROR") {
    console.error(message);
    return;
  }

  if (level === "WARN") {
    console.warn(message);
    return;
  }

  console.log(message);
}

module.exports = {
  log,
};
