const advisorConfig=window.SUPABASE_CONFIG||{};
let advisorClient=null;

async function advisorAvailability(startDate){
  if(!advisorConfig.url||!advisorConfig.anonKey)return null;
  if(!advisorClient){
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    advisorClient=createClient(advisorConfig.url,advisorConfig.anonKey,{auth:{persistSession:false}});
  }
  const {data,error}=await advisorClient.rpc('get_advisor_availability',{p_start_date:startDate||new Date().toISOString().slice(0,10)});
  if(error)throw error;
  return data||[];
}

function renderAdvisorGrid(data){
  const grid=document.querySelector('[data-public-advisors]');
  if(!grid||!data.length)return;
  grid.replaceChildren(...data.map(advisor=>{const card=document.createElement('div');card.className='advisor';const name=document.createElement('strong');name.textContent=advisor.name;const areas=document.createElement('span');areas.textContent=advisor.areas;card.append(name,areas);return card;}));
}

function renderAdvisorSelect(data){
  const select=document.querySelector('select[name="advisor_name"]');
  if(!select||!data.length)return;
  const current=select.value;
  const placeholder=select.options[0]?.cloneNode(true)||new Option('Converse com o docente antes de selecionar','');
  const options=data.map(advisor=>{const option=new Option(advisor.available?advisor.name:`${advisor.name} — indisponível neste semestre`,advisor.name);option.disabled=!advisor.available;return option;});
  select.replaceChildren(placeholder,...options);
  if(current&&data.some(advisor=>advisor.name===current&&advisor.available))select.value=current;
  else select.value='';
  let note=document.querySelector('.advisor-availability-note');
  if(!note){note=document.createElement('small');note.className='advisor-availability-note';note.textContent='Cada docente pode receber no máximo cinco novas orientações por semestre.';select.insertAdjacentElement('afterend',note);}
}

async function loadPublicAdvisors(){
  const startDate=document.querySelector('[name="start_date"]')?.value||'';
  try{const data=await advisorAvailability(startDate);if(!data?.length)return;renderAdvisorGrid(data);renderAdvisorSelect(data);}catch(error){console.error('Não foi possível atualizar a disponibilidade dos orientadores:',error);}
}

document.querySelector('[name="start_date"]')?.addEventListener('change',loadPublicAdvisors);
loadPublicAdvisors();