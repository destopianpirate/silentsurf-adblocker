const puppeteer = require('puppeteer');

async function testScrape(url) {
  let browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 6000));
  
  const content = await page.evaluate(() => {
     const links = Array.from(document.querySelectorAll('a')).map(a => a.href);
     const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText);
     const divs = Array.from(document.querySelectorAll('div')).filter(d => d.innerText && d.innerText.includes('Copy')).map(d => d.innerText);
     return { links, buttons, divs };
  });

  console.log('Page elements:', content);
  
  await browser.close();
}

testScrape('https://www.diskwala.com/app/6a304f2869eabf8720bf034b');
