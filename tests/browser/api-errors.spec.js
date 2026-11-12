import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('documental:tour:v1','done'));
  await page.route('**/api/config',route=>route.fulfill({json:{parameters:{uploadMb:50,uploadFiles:20}}}));
  await page.route('**/api/runs',route=>route.fulfill({json:[]}));
});

for(const response of [
  {name:'empty proxy error',status:502,contentType:'text/plain',body:''},
  {name:'HTML proxy error',status:503,contentType:'text/html',body:'<html><body>Service Unavailable</body></html>'},
  {name:'incomplete successful response',status:200,contentType:'application/json',body:'[{"id":'},
]){
  test(`${response.name} shows a recoverable message in Spanish`,async({page})=>{
    await page.route('**/api/requirements',route=>route.fulfill(response));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText(/servicio|servidor/i);
    await expect(page.getByRole('alert')).toContainText(/intenta|intentar/i);
    await expect(page.getByRole('alert')).not.toContainText(/JSON|Unexpected|<html>/);
    if(response.status>=400)await expect(page.getByRole('alert')).toContainText(String(response.status));
  });
}

test('JSON validation errors keep their explanation',async({page})=>{
  await page.route('**/api/requirements',route=>route.fulfill({status:409,json:{error:'Espera a que el documento esté preparado.'}}));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Espera a que el documento esté preparado.');
});
