const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function testScrape(url) {
  let browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--disable-dev-shm-usage', '--disable-gpu']
  });
  const page = await browser.newPage();
  
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36');
  await page.setViewport({ width: 412, height: 915 });

  let mediaUrl = null;
  await page.setRequestInterception(true);
  page.on('request', request => request.continue());
  page.on('response', async response => {
      try {
        const respUrl = response.url();
        const contentType = response.headers()['content-type'] || '';
        if ((contentType.includes('video/') || respUrl.includes('.mp4') || respUrl.includes('.m3u8')) && !respUrl.includes('blob:')) {
          if (!mediaUrl) mediaUrl = respUrl;
        }
      } catch (e) {}
  });

  console.log('Navigating...');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('Waiting 10s...');
  await new Promise(r => setTimeout(r, 10000));
  
  await page.screenshot({ path: 'diskwala_stealth.png' });

  if (!mediaUrl) {
    mediaUrl = await page.evaluate(() => {
      const vid = document.querySelector('video');
      if (vid && vid.src && !vid.src.includes('blob:')) return vid.src;
      return null;
    });
  }
  
  console.log('Stealth Media URL:', mediaUrl);
  await browser.close();
}

testScrape('https://www.diskwala.com/app/6a30309469eabf8720bdd67a');
