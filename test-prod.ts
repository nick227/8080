async function run() {
  const baseUrl = 'https://server-production-bcfc.up.railway.app';
  
  const email = 'test' + Date.now() + '@example.com';
  console.log('Registering', email);
  
  // Register
  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName: 'Test User' })
  });
  if (!regRes.ok) throw new Error('Register failed: ' + await regRes.text());
  
  // Login
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' })
  });
  if (!loginRes.ok) throw new Error('Login failed: ' + await loginRes.text());
  
  const cookie = loginRes.headers.get('set-cookie');
  if (!cookie) throw new Error('No cookie received');
  console.log('Got cookie:', cookie.split(';')[0]);

  console.log('Uploading file...');
  const formData = new FormData();
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const buffer = Buffer.from(b64, 'base64');
  formData.append('file', new Blob([buffer], { type: 'image/png' }), 'test.png');
  
  const uploadRes = await fetch(`${baseUrl}/media`, {
    method: 'POST',
    headers: {
      'cookie': cookie
    },
    body: formData
  });
  
  if (!uploadRes.ok) throw new Error('Upload failed: ' + await uploadRes.text());
  const media = await uploadRes.json();
  console.log('Media uploaded:', media);

  // Playback
  console.log('Fetching playback...');
  const pbRes = await fetch(`${baseUrl}/media/${media.data.id}/playback`, {
    headers: { 'cookie': cookie },
    redirect: 'manual' // We want to catch the 307
  });
  
  if (pbRes.status !== 307) {
      console.warn('Playback did not return 307, got:', pbRes.status, await pbRes.text().catch(()=>''));
  } else {
      console.log('Playback 307 Location:', pbRes.headers.get('location'));
      // Follow the 307 to verify the file
      const fileRes = await fetch(pbRes.headers.get('location')!);
      console.log('File fetch status:', fileRes.status);
      console.log('File content:', await fileRes.text());
  }
}

run().catch(console.error);
