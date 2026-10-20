try {
  const response = await fetch('http://127.0.0.1:3000/api/airports', {
    headers: { 'x-api-key': process.env.AFS_LOCAL_API_KEY }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !(await response.json()).length) process.exitCode = 1;
} catch { process.exitCode = 1; }
