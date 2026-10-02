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

  // Playback of previously uploaded media
  const mediaId = 'cmur5o5hd000jcqprbnsu0dv6';
  console.log('Fetching playback for old media:', mediaId);
  const pbRes = await fetch(`${baseUrl}/media/${mediaId}/playback`, {
    headers: { 'cookie': cookie },
    redirect: 'manual'
  });
  
  if (pbRes.status !== 307) {
      console.warn('Playback did not return 307, got:', pbRes.status, await pbRes.text().catch(()=>''));
  } else {
      console.log('Playback 307 Location:', pbRes.headers.get('location'));
      const fileRes = await fetch(pbRes.headers.get('location')!);
      console.log('File fetch status:', fileRes.status);
      console.log('File content:', await fileRes.text());
  }
}

run().catch(console.error);
