import { useState } from 'react';
import { ArrowRight, Check, Calculator, Smartphone, ShieldCheck } from 'lucide-react';
import { addMoney, subtractMoney, calculateMarginRatio } from '../lib/money';
import { formatBRL, formatPercent } from '../types/garage';
import { useAuth } from '../context/AuthContext';
import heroShowroomImg from '../assets/images/hero_garage_showroom_1794570998522.jpg';

interface LandingPageProps {
  navigate: (to: string) => void;
}

export function LandingPage({ navigate }: LandingPageProps) {
  const { user } = useAuth();
  const [compra, setCompra] = useState(68000);
  const [despesas, setDespesas] = useState(3450);
  const [venda, setVenda] = useState(82900);

  const custoTotal = addMoney(compra, despesas);
  const lucro = subtractMoney(venda, custoTotal);
  const margem = calculateMarginRatio(venda, custoTotal);

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones (Wordmark/Logo — 4 Links — 1 Primary CTA + Auth Link) */}
      <header className="sticky top-0 z-30 bg-brand-dark/95 backdrop-blur-md border-b border-slate-800 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="CS22 Garage - Início"
            className="flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <img
              src="/assets/aistudio/Logo_automotivo_CS22_Garage_deb1d1bd.png"
              alt="CS22 Garage"
              className="h-8 sm:h-9 w-auto object-contain"
            />
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <a href="#fluxo" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Como funciona
            </a>
            <a href="#calculadora" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Calculadora
            </a>
            <a href="#precos" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Preços
            </a>
            <button
              type="button"
              onClick={() => navigate('/g/premium-motors')}
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Vitrine exemplo
            </button>
          </nav>

          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate(user ? '/app/painel' : '/login')}
              className="px-3 py-2 text-xs sm:text-sm font-medium text-slate-200 hover:text-white whitespace-nowrap shrink-0"
            >
              {user ? 'Painel' : 'Entrar'}
            </button>
            <button
              type="button"
              onClick={() => navigate(user ? '/app/painel' : '/cadastro')}
              className="min-h-[40px] px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-brand-blue hover:bg-brand-blue-hover rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {user ? 'Abrir garagem' : 'Testar 7 dias grátis'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Split */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 lg:py-20 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-xs font-semibold text-brand-blue mb-3">
              Gestão enxuta para garagens e revendas independentes
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold tracking-tight text-slate-900 leading-[1.12] [text-wrap:balance]">
              Uma vitrine no link da bio e o lucro real de cada carro vendido.
            </h1>
            <p className="mt-5 text-base text-slate-600 leading-relaxed max-w-xl">
              Pare de anotar mecânica, estética, vencimentos e comissão no caderno ou no WhatsApp. Cadastre o veículo pelo celular,
              publique sua página própria e descubra exatamente quanto cada venda colocou no bolso.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(user ? '/app/painel' : '/cadastro')}
                className="min-h-[48px] px-6 py-3 bg-brand-blue hover:bg-brand-blue-hover text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>{user ? 'Acessar meu painel' : 'Criar conta sem cartão'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/g/premium-motors')}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold rounded-xl transition-colors text-center whitespace-nowrap"
              >
                Ver vitrine de exemplo
              </button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
              <span>7 dias grátis sem cartão</span>
              <span aria-hidden="true">·</span>
              <span>Funciona no celular</span>
              <span aria-hidden="true">·</span>
              <span>Vitrine /g/sua-garagem</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[260px] lg:min-h-[400px] rounded-2xl overflow-hidden border border-slate-200 bg-brand-dark">
              <img
                src={heroShowroomImg}
                alt="Showroom moderno de veículos seminovos"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 4-Step Mechanism Flow */}
      <section id="fluxo" className="bg-slate-50 border-y border-slate-200 py-14 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Comprar, anunciar, vender e medir em um único dia pelo celular.
            </h2>
            <p className="mt-2.5 text-sm sm:text-base text-slate-600">
              Sem planilhas paralelas e sem telas complicadas. Só os números que o dono da garagem olha toda semana.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                num: '01. Cadastre o carro',
                desc: 'Informe compra, placa (privada só para você), preço anunciado e até 10 fotos comprimidas direto do celular.',
              },
              {
                num: '02. Publique na bio',
                desc: 'Seu link /g/sua-garagem já nasce com busca, filtro de ano e preço, pré-visualização no WhatsApp e botão direto.',
              },
              {
                num: '03. Lance despesas e alertas',
                desc: 'Mecânica, estética, comissão e lembretes de IPVA/seguro entram organizados para nada vencer sem aviso.',
              },
              {
                num: '04. Venda e veja o lucro',
                desc: 'Ao registrar a venda, o carro sai da vitrine na hora e você vê CMV, lucro líquido, margem e dias em estoque.',
              },
            ].map((step) => (
              <div key={step.num} className="bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="font-display text-base font-bold text-slate-900">{step.num}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive Profit Calculator Hook */}
      <section id="calculadora" className="py-14 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-brand-blue mb-2">
                <Calculator className="w-4 h-4" />
                <span>Simulador de lucro por veículo</span>
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
                Quanto sobrou de verdade no último carro que você vendeu?
              </h2>
              <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
                Muita garagem olha só a diferença entre compra e venda e esquece pneu, funilaria, documentação e comissão.
                No CS22 Garage, cada gasto soma automaticamente no CMV do carro.
              </p>
              <div className="mt-6 space-y-2.5 text-sm text-slate-700">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-4 h-4 text-brand-blue shrink-0" />
                  <span>Painel mostra dinheiro parado, lembretes de vencimento e carros +60 dias</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-brand-blue shrink-0" />
                  <span>Placa, valor de compra e despesas nunca aparecem na vitrine</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-slate-50 border border-slate-200 rounded-2xl p-6 sm:p-8">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Valor de compra (R$)</label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={compra}
                    onChange={(e) => setCompra(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Despesas totais (R$)</label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={despesas}
                    onChange={(e) => setDespesas(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Valor de venda (R$)</label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={venda}
                    onChange={(e) => setVenda(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-slate-500">Custo total (CMV)</p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
                    {formatBRL(custoTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Lucro real</p>
                  <p
                    className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                      lucro >= 0 ? 'text-brand-green' : 'text-red-700'
                    }`}
                  >
                    {formatBRL(lucro)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Margem líquida</p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
                    {formatPercent(margem)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section — Plano único Padrão R$ 49,90/mês */}
      <section id="precos" className="bg-slate-50 border-t border-slate-200 py-14 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Preço único e direto, sem comissão por carro vendido.
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600">
              Teste completo por 7 dias sem cadastrar cartão. Depois, pague via Pix, boleto ou cartão no Asaas.
            </p>
          </div>

          <div className="mt-10 max-w-md mx-auto">
            <div className="bg-white border-2 border-brand-dark rounded-2xl p-6 sm:p-8 flex flex-col">
              <p className="text-xs font-semibold text-brand-blue">Plano único · Tudo incluso</p>
              <h3 className="mt-1 font-display text-xl font-bold text-slate-900">Plano Padrão</h3>
              <p className="mt-4 font-mono text-4xl font-bold tabular-nums text-slate-900">
                R$ 49,90<span className="text-sm font-sans font-normal text-slate-500">/mês</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">7 dias de teste grátis sem cartão · Cancele quando quiser</p>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-600 flex-1">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-brand-green shrink-0" />
                  <span>Vitrine pública /g/sua-garagem pronta para a bio</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-brand-green shrink-0" />
                  <span>Veículos, até 10 fotos por carro e despesas ilimitadas</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-brand-green shrink-0" />
                  <span>Painel de lucro real, margem e lembretes de vencimento</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-brand-green shrink-0" />
                  <span>Contadores de visualizações, WhatsApp e auditoria de vendas</span>
                </li>
              </ul>
              <button
                type="button"
                onClick={() => navigate(user ? '/app/assinatura' : '/cadastro')}
                className="mt-6 w-full min-h-[46px] px-4 py-2.5 bg-brand-blue hover:bg-brand-blue-hover text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {user ? 'Gerenciar assinatura' : 'Começar 7 dias grátis'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Brand Dark Footer */}
      <footer className="bg-brand-dark border-t border-slate-800 text-slate-300 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-4">
            <img
              src="/assets/aistudio/Logo_automotivo_CS22_Garage_deb1d1bd.png"
              alt="CS22 Garage"
              className="h-7 w-auto object-contain"
            />
            <span className="text-slate-400">Vitrine e lucro real por veículo</span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <button type="button" onClick={() => navigate('/login')} className="hover:text-white transition-colors">
              Entrar no painel
            </button>
            <button type="button" onClick={() => navigate('/cadastro')} className="hover:text-white transition-colors">
              Criar conta
            </button>
            <button type="button" onClick={() => navigate('/g/premium-motors')} className="hover:text-white transition-colors">
              Vitrine exemplo
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
