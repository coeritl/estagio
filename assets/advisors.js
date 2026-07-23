const advisorConfig=window.SUPABASE_CONFIG||{};

async function loadPublicAdvisors(){
  if(!advisorConfig.url||!advisorConfig.anonKey)return;
  try{
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const client=createClient(advisorConfig.url,advisorConfig.anonKey,{auth:{persistSession:false}});
    const {data,error}=await client.from('internship_advisors').select('id,name,areas,display_order').eq('is_active',true).order('display_order').order('name');
    if(error)throw error;
    if(!data?.length)return;
    const grid=document.querySelector('[data-public-advisors]');
    if(grid){
      const cards=data.map(advisor=>{const card=document.createElement('div');card.className='advisor';const name=document.createElement('strong');name.textContent=advisor.name;const areas=document.createElement('span');areas.textContent=advisor.areas;card.append(name,areas);return card;});
      grid.replaceChildren(...cards);
    }
    const select=document.querySelector('select[name="advisor_name"]');
    if(select){
      const current=select.value;
      const placeholder=select.options[0]?.cloneNode(true)||new Option('Converse com o docente antes de selecionar','');
      select.replaceChildren(placeholder,...data.map(advisor=>new Option(advisor.name,advisor.name)));
      if(current&&data.some(advisor=>advisor.name===current))select.value=current;
    }
  }catch(error){console.error('Não foi possível atualizar a lista de orientadores:',error);}
}
loadPublicAdvisors();