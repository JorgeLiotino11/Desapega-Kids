import express from 'express';
import { db } from '../firebase-admin.js';
import { requireAuth } from '../middleware/auth.js';
import { updateGlobalCounter, getGlobalStats } from '../firebase-counters.js'; // Importação do novo módulo

const router = express.Router();

<<<<<<< HEAD
// IMPORTANTE: Rotas específicas ANTES de rotas com parâmetros dinâmicos

// Estatísticas (AGORA OTIMIZADA)
router.get('/estatisticas', async (req, res) => {
    try {
        // Apenas lê o documento de estatísticas pré-calculadas
        const stats = await getGlobalStats();
        
        res.json({
            success: true,
            ...stats
        });

    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        // Retorna valores zerados em caso de erro
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao buscar estatísticas',
            totalItens: 0,
            itensDoados: 0,
            itensDisponiveis: 0,
            familiasAjudadas: 0,
            totalDoadores: 0,
            cidades: 1
        });
    }
});

// Listar itens (Mantido o código original, mas com a ressalva de que o filtro no JS é ineficiente)
router.get('/', async (req, res) => {
    try {
        // Adicionando a definição de userId para evitar o ReferenceError, caso seja usado no filtro.
        // Se a rota não exigir autenticação, req.session.user pode ser undefined.
        const userId = req.session.user ? req.session.user.uid : null; 
        
        const { categoria, estado, doadorId, status, limit } = req.query;
        
        // Buscar TODOS os itens (ou com limite)
        let query = db.collection('itens');
        
        const limitNum = limit ? parseInt(limit) : 100;
        query = query.limit(limitNum * 3); // Pegar mais para compensar filtros

        const snapshot = await query.get();
        
        let itens = [];
        snapshot.forEach(doc => {
            itens.push({ id: doc.id, ...doc.data() });
        });

        // Aplicar TODOS os filtros no código (client-side)
        if (status) {
            itens = itens.filter(item => item.status === status);
        }
        if (categoria) {
            itens = itens.filter(item => item.categoria === categoria);
        }
        if (estado) {
            itens = itens.filter(item => item.estado === estado);
        }
        if (doadorId) {
            itens = itens.filter(item => item.doadorId === doadorId);
        }

        // Ordenar por timestamp (mais recentes primeiro)
        itens.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Aplicar limite final
        if (limit) {
            itens = itens.slice(0, parseInt(limit));
        }

        res.json({ 
            success: true, 
            itens,
            total: itens.length
        });

    } catch (error) {
        console.error('Erro ao listar itens:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao listar itens',
            itens: []
        });
    }
});

// Cadastrar item
router.post('/', requireAuth, async (req, res) => {
    try {
        const { nome, descricao, categoria, tamanho, estado, imagens } = req.body;
        const userId = req.session.user.uid;

        // Validação dos campos obrigatórios
        const categoriasValidas = ['roupas', 'brinquedos', 'livros', 'calcados', 'acessorios', 'outros'];
        const estadosValidos = ['novo', 'seminovo', 'usado'];

        if (!nome || !descricao || !categoria || !estado) {
            return res.status(400).json({ success: false, message: 'Preencha todos os campos obrigatórios' });
        }
        if (!categoriasValidas.includes(categoria)) {
            return res.status(400).json({ success: false, message: 'Categoria inválida' });
        }
        if (!estadosValidos.includes(estado)) {
            return res.status(400).json({ success: false, message: 'Estado inválido' });
        }

        // Criar o objeto do item
        const novoItem = {
            nome: nome.trim(),
            descricao: descricao.trim(),
            categoria,
            tamanho: tamanho?.trim() || null,
            estado,
            imagens: Array.isArray(imagens) ? imagens : [],
            doadorId: userId,
            doadorNome: req.session.user.displayName || req.session.user.email,
            status: 'disponivel',
            criadoEm: new Date().toISOString(),
            atualizadoEm: new Date().toISOString(),
            timestamp: Date.now()
        };

        // Salvar no Firestore
        const docRef = await db.collection('itens').add(novoItem);

        // --- ATUALIZAÇÃO DOS CONTADORES ---
        // 1. Incrementa o total de itens disponíveis
        await updateGlobalCounter('itensDisponiveis', 1);
        
        // 2. Verifica se é o primeiro item do doador para incrementar o totalDoadores
        const doadorItensSnapshot = await db.collection('itens')
            .where('doadorId', '==', userId)
            .limit(2) // Limita a 2 para saber se já existe outro item
            .get();
            
        // Se o tamanho for 1, é o primeiro item que ele está doando
        if (doadorItensSnapshot.size === 1) { 
            await updateGlobalCounter('totalDoadores', 1);
        }
        // ----------------------------------

        res.status(201).json({ 
            success: true, 
            message: 'Item cadastrado com sucesso!',
            itemId: docRef.id,
            item: { id: docRef.id, ...novoItem }
        });

    } catch (error) {
        console.error('Erro ao cadastrar item:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao cadastrar item. Tente novamente.' 
        });
    }
});

// Editar item
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, descricao, categoria, tamanho, estado, imagens, status } = req.body;
        const userId = req.session.user.uid;

        const itemRef = db.collection('itens').doc(id);
        const itemDoc = await itemRef.get();

        if (!itemDoc.exists) {
            return res.status(404).json({ success: false, message: 'Item não encontrado' });
        }

        const itemData = itemDoc.data();
        if (itemData.doadorId !== userId) {
            return res.status(403).json({ success: false, message: 'Você não tem permissão para editar este item' });
        }

        // --- ATUALIZAÇÃO DOS CONTADORES (Se o status mudar) ---
        const oldStatus = itemData.status;
        const newStatus = status || oldStatus;
        
        if (oldStatus !== newStatus) {
            // Lógica de decremento
            if (oldStatus === 'disponivel') {
                await updateGlobalCounter('itensDisponiveis', -1);
            } else if (oldStatus === 'doado') {
                await updateGlobalCounter('itensDoados', -1);
            }
            
            // Lógica de incremento
            if (newStatus === 'disponivel') {
                await updateGlobalCounter('itensDisponiveis', 1);
            } else if (newStatus === 'doado') {
                await updateGlobalCounter('itensDoados', 1);
            }
        }
        // ------------------------------------------------------

        // Preparar dados para atualização
        const dadosAtualizados = {
            atualizadoEm: new Date().toISOString(),
            timestamp: Date.now()
        };

        if (nome) dadosAtualizados.nome = nome.trim();
        if (descricao) dadosAtualizados.descricao = descricao.trim();
        if (categoria) dadosAtualizados.categoria = categoria;
        if (tamanho !== undefined) dadosAtualizados.tamanho = tamanho?.trim() || null;
        if (estado) dadosAtualizados.estado = estado;
        if (imagens !== undefined) dadosAtualizados.imagens = Array.isArray(imagens) ? imagens : [];
        if (status) dadosAtualizados.status = status;

        // Atualizar no Firestore
        await itemRef.update(dadosAtualizados);

        res.json({ 
            success: true, 
            message: 'Item atualizado com sucesso!',
            item: { id, ...itemData, ...dadosAtualizados }
        });

    } catch (error) {
        console.error('Erro ao editar item:', error);
        res.status(500).json({ success: false, message: 'Erro ao editar item' });
    }
});

// Deletar item
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.uid;

        const itemRef = db.collection('itens').doc(id);
        const itemDoc = await itemRef.get();

        if (!itemDoc.exists) {
            return res.status(404).json({ success: false, message: 'Item não encontrado' });
        }

        const itemData = itemDoc.data();
        if (itemData.doadorId !== userId) {
            return res.status(403).json({ success: false, message: 'Você não tem permissão para deletar este item' });
        }

        // --- ATUALIZAÇÃO DOS CONTADORES ---
        // Decrementa o contador do status atual
        if (itemData.status === 'disponivel') {
            await updateGlobalCounter('itensDisponiveis', -1);
        } else if (itemData.status === 'doado') {
            await updateGlobalCounter('itensDoados', -1);
        }
        // O contador 'totalDoadores' não é decrementado, pois um doador que já doou deve ser contado
        // ----------------------------------

        // Deletar do Firestore
        await itemRef.delete();

        res.json({ success: true, message: 'Item deletado com sucesso!' });

    } catch (error) {
        console.error('Erro ao deletar item:', error);
        res.status(500).json({ success: false, message: 'Erro ao deletar item' });
    }
});

// Buscar item por ID (DEVE SER A ÚLTIMA ROTA GET)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id || id.length < 10) {
            return res.status(400).json({ 
                success: false, 
                message: 'ID inválido' 
            });
        }

        const doc = await db.collection('itens').doc(id).get();

        if (!doc.exists) {
            return res.status(404).json({ 
                success: false, 
                message: 'Item não encontrado' 
            });
        }

        res.json({ 
            success: true, 
            item: { id: doc.id, ...doc.data() }
        });

    } catch (error) {
        console.error('Erro ao buscar item:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Erro ao buscar item' 
        });
    }
=======
// ===================== 📊 Estatísticas =====================
router.get('/estatisticas', async (req, res) => {
  try {
    const snapshot = await db.collection('itens').limit(1000).get();
    const itens = snapshot.docs.map(doc => doc.data());

    const totalItens = itens.length;
    const itensDoados = itens.filter(i => i.status === 'doado').length;
    const itensDisponiveis = itens.filter(i => i.status === 'disponivel').length;
    const familiasAjudadas = Math.floor(itensDoados * 0.7);
    const totalDoadores = new Set(itens.map(i => i.doadorId)).size;

    res.json({
      success: true,
      totalItens,
      itensDoados,
      itensDisponiveis,
      familiasAjudadas,
      totalDoadores,
      cidades: 1,
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao buscar estatísticas',
    });
  }
});

// ===================== 📋 Listar Itens =====================
router.get('/', async (req, res) => {
  try {
    const { categoria, estado, doadorId, status, limit } = req.query;

    let query = db.collection('itens');
    const limitNum = limit ? parseInt(limit) : 100;
    query = query.limit(limitNum * 3);

    const snapshot = await query.get();
    let itens = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (status) itens = itens.filter(i => i.status === status);
    if (categoria) itens = itens.filter(i => i.categoria === categoria);
    if (estado) itens = itens.filter(i => i.estado === estado);
    if (doadorId) itens = itens.filter(i => i.doadorId === doadorId);

    itens.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (limit) itens = itens.slice(0, parseInt(limit));

    res.json({ success: true, itens, total: itens.length });
  } catch (error) {
    console.error('Erro ao listar itens:', error);
    res.status(500).json({
      success: false,
      message: 'Erro ao listar itens',
      itens: [],
    });
  }
});

// ===================== ❤️ Cadastrar Item =====================
router.post('/', requireAuth, async (req, res) => {
  try {
    const { nome, descricao, categoria, tamanho, estado, imagens } = req.body;
    const userId = req.session.user.uid;

    if (!nome || !descricao || !categoria || !estado) {
      return res.status(400).json({
        success: false,
        message: 'Preencha todos os campos obrigatórios',
      });
    }

    const categoriasValidas = [
      'roupas',
      'brinquedos',
      'livros',
      'calcados',
      'acessorios',
      'outros',
    ];
    if (!categoriasValidas.includes(categoria)) {
      return res.status(400).json({ success: false, message: 'Categoria inválida' });
    }

    const estadosValidos = ['novo', 'seminovo', 'usado'];
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ success: false, message: 'Estado inválido' });
    }

    // ===================== 🖼️ Validação das imagens =====================
    let imagensProcessadas = [];
    if (Array.isArray(imagens) && imagens.length > 0) {
      if (imagens.length > 5) {
        return res.status(400).json({
          success: false,
          message: 'Você pode enviar no máximo 5 imagens',
        });
      }

      imagensProcessadas = imagens.filter(img => typeof img === 'string').map((imgBase64, index) => {
        const tamanhoEmBytes = Buffer.byteLength(imgBase64, 'base64');
        const tamanhoEmMB = tamanhoEmBytes / (1024 * 1024);

        if (tamanhoEmMB > 5) {
          throw new Error(`Imagem ${index + 1} excede o limite de 5 MB`);
        }

        // valida formato básico base64 (data:image/jpeg;base64,xxxx)
        if (!imgBase64.startsWith('data:image')) {
          throw new Error(`Imagem ${index + 1} não é válida`);
        }

        return imgBase64;
      });
    }

    // ===================== 💾 Salvar Item =====================
    const novoItem = {
      nome: nome.trim(),
      descricao: descricao.trim(),
      categoria,
      tamanho: tamanho?.trim() || null,
      estado,
      imagens: imagensProcessadas,
      doadorId: userId,
      doadorNome: req.session.user.displayName || req.session.user.email,
      status: 'disponivel',
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      timestamp: Date.now(),
    };

    const docRef = await db.collection('itens').add(novoItem);

    res.status(201).json({
      success: true,
      message: 'Item cadastrado com sucesso!',
      itemId: docRef.id,
      item: { id: docRef.id, ...novoItem },
    });
  } catch (error) {
    console.error('❌ Erro ao cadastrar item:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro ao cadastrar item. Tente novamente.',
    });
  }
});

// ===================== ✏️ Editar Item =====================
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao, categoria, tamanho, estado, imagens, status } = req.body;
    const userId = req.session.user.uid;

    const itemRef = db.collection('itens').doc(id);
    const itemDoc = await itemRef.get();

    if (!itemDoc.exists) {
      return res.status(404).json({ success: false, message: 'Item não encontrado' });
    }

    const itemData = itemDoc.data();
    if (itemData.doadorId !== userId) {
      return res.status(403).json({ success: false, message: 'Sem permissão para editar este item' });
    }

    const dadosAtualizados = {
      atualizadoEm: new Date().toISOString(),
      timestamp: Date.now(),
    };

    if (nome) dadosAtualizados.nome = nome.trim();
    if (descricao) dadosAtualizados.descricao = descricao.trim();
    if (categoria) dadosAtualizados.categoria = categoria;
    if (tamanho !== undefined) dadosAtualizados.tamanho = tamanho?.trim() || null;
    if (estado) dadosAtualizados.estado = estado;
    if (status) dadosAtualizados.status = status;

    // 🖼️ Atualização das imagens (também com limite 5 MB)
    if (Array.isArray(imagens)) {
      if (imagens.length > 5) {
        return res.status(400).json({ success: false, message: 'Máximo de 5 imagens permitido' });
      }
      dadosAtualizados.imagens = imagens.filter(img => typeof img === 'string').map((imgBase64, index) => {
        const tamanhoEmBytes = Buffer.byteLength(imgBase64, 'base64');
        const tamanhoEmMB = tamanhoEmBytes / (1024 * 1024);
        if (tamanhoEmMB > 5) {
          throw new Error(`Imagem ${index + 1} excede o limite de 5 MB`);
        }
        return imgBase64;
      });
    }

    await itemRef.update(dadosAtualizados);

    res.json({
      success: true,
      message: 'Item atualizado com sucesso!',
      item: { id, ...itemData, ...dadosAtualizados },
    });
  } catch (error) {
    console.error('Erro ao editar item:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro ao editar item',
    });
  }
});

// ===================== 🗑️ Deletar Item =====================
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.uid;

    const itemRef = db.collection('itens').doc(id);
    const itemDoc = await itemRef.get();

    if (!itemDoc.exists) {
      return res.status(404).json({ success: false, message: 'Item não encontrado' });
    }

    const itemData = itemDoc.data();
    if (itemData.doadorId !== userId) {
      return res.status(403).json({ success: false, message: 'Sem permissão para deletar este item' });
    }

    await itemRef.delete();

    res.json({ success: true, message: 'Item deletado com sucesso!' });
  } catch (error) {
    console.error('Erro ao deletar item:', error);
    res.status(500).json({ success: false, message: 'Erro ao deletar item' });
  }
});

// ===================== 🔍 Buscar Item por ID =====================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id.length < 10) {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }

    const doc = await db.collection('itens').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Item não encontrado' });
    }

    res.json({ success: true, item: { id: doc.id, ...doc.data() } });
  } catch (error) {
    console.error('Erro ao buscar item:', error);
    res.status(500).json({ success: false, message: 'Erro ao buscar item' });
  }
>>>>>>> 9e08b2f72065ca81cb60b7115099942962a1a225
});

export default router;
""