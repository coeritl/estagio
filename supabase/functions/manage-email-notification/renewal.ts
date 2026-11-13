export function renewalMessage(agreement: any, contact: any, date: string) {
  const end = String(agreement.end_date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('O convênio não possui data de término válida.');
  const days = Math.round((Date.parse(end) - Date.parse(date)) / 86400000);
  if (days > 90) throw new Error('A proposta está disponível para convênios vencidos ou com vencimento nos próximos 90 dias.');
  const recipient = String(contact?.company_email || '').trim().toLowerCase();
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) throw new Error('Atualize o e-mail da concedente no cadastro de origem antes de enviar.');
  const name = String(contact?.representative_name || 'Responsável pela instituição');
  const number = String(agreement.agreement_number || agreement.academic_agreement_id);
  const endFormatted = end.split('-').reverse().join('/');
  const subject = `Proposta de renovação do convênio de estágio nº ${number} — IFMS Três Lagoas`;
  const body = `À instituição ${agreement.external_institution},\nA/C ${name}\n\nA Coordenação de Extensão e Relações Institucionais (COERI) do IFMS Campus Três Lagoas deseja consultar o interesse na renovação da parceria de estágio. O convênio nº ${number} ${days < 0 ? 'venceu em' : 'tem término previsto para'} ${endFormatted}.\n\nDados atualmente registrados:\nInstituição: ${agreement.external_institution}\nDescrição/CNPJ: ${agreement.description || 'Não informado'}\nConvênio: ${number}\nInício: ${agreement.start_date ? agreement.start_date.split('-').reverse().join('/') : 'Não informado'}\nTérmino: ${endFormatted}\nE-mail: ${recipient}\nRepresentante: ${name}\nCargo: ${contact?.representative_role || 'Não informado'}\n\nPor favor, responda a este e-mail confirmando o interesse na renovação e se os dados acima permanecem corretos. Caso haja alterações, informe a razão social/CNPJ, o e-mail de contato e o nome e cargo do representante atual, além de um telefone para contato. Não é necessário encaminhar documentos pessoais nesta resposta.\n\nApós seu retorno, a COERI orientará os procedimentos e a documentação necessários. Esta mensagem é uma consulta de interesse e não renova o convênio nem altera sua vigência.\n\nAtenciosamente,\nCoordenação de Extensão e Relações Institucionais — COERI\nIFMS Campus Três Lagoas\ncoeri.tl@ifms.edu.br`;
  return { recipient, subject, body, agreementId: agreement.academic_agreement_id };
}
