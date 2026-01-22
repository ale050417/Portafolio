//animacion
var typed = new Typed("#typed", {
    strings: ["Junior Software Developer", "Desarrollo web y móvil", "Aprender · Practicar · Construir"],
    typeSpeed: 50,
    backSpeed: 20,
    backDelay: 3000,
    showCursor: false,
    loop: true
});

//tema
function theme() {
    const darkBtn = document.getElementById('darkBtn');
    const lightBtn = document.getElementById('lightBtn');

    document.body.classList.toggle('light');

    if (document.body.classList.contains('light')) {
        darkBtn.style.display = 'block';
        lightBtn.style.display = 'none';
    } else {
        darkBtn.style.display = 'none';
        lightBtn.style.display = 'block';
    }
}

const graph = document.getElementById("activityGraph");

const today = new Date().toISOString().split("T")[0];

//menu
const menuItems = document.querySelectorAll('.nav .item');

menuItems.forEach(item => {
    item.addEventListener('click', () => {
        menuItems.forEach(item => item.classList.remove('active'));
        item.classList.add('active');
    })
})
// Smooth scroll dentro del contenedor .content .wrapper
document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();

        const targetId = link.getAttribute('href');
        const targetEl = document.querySelector(targetId);
        const wrapper = document.querySelector('.content .wrapper');

        if (!targetEl || !wrapper) return;

        // Distancia del target dentro del wrapper
        const top = targetEl.offsetTop;

        wrapper.scrollTo({
            top: top - 100, // si queremos margen arriba hay que ajustar
            behavior: 'smooth'
        });
    });
});


const form = document.getElementById("contactForm");

if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        Swal.fire({
            title: 'Enviando mensaje',
            html: `
                <p style="margin:0">
                Procesando tu consulta…
                </p>
            `,
            allowOutsideClick: false,
            background: '#111a2c',
            color: '#DBDBDB',
            customClass: {
                popup: 'swal-rounded'
            },
            didOpen: () => {
                Swal.showLoading();
            }
        });


        const formData = {
            name: form.name.value.trim(),
            email: form.email.value.trim(),
            subject: form.subject.value.trim(),
            message: form.message.value.trim(),
        };

        try {
            const res = await fetch("/api/contact", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            const raw = await res.text();

            let data = {};
            try {
                data = raw ? JSON.parse(raw) : {};
            } catch (_) {
            }

            if (!res.ok) {
                const msg = data.error || raw?.slice(0, 120) || "Error al enviar.";
                throw new Error(msg);
            }


            Swal.fire({
                icon: 'success',
                title: 'Mensaje enviado',
                html: `
                    <p style="margin:0">
                    Gracias por contactarme.<br>
                    Te responderé a la brevedad.
                    </p>
                    `,
                confirmButtonText: 'Perfecto',
                confirmButtonColor: '#4FC6CE',
                background: '#111a2c',
                color: '#DBDBDB',
                iconColor: '#4FC6CE',
                customClass: {
                    popup: 'swal-rounded'
                },
                showClass: {
                    popup: 'animate__animated animate__fadeInUp'
                }
            });

            form.reset();
        } catch (err) {
            Swal.fire({
                icon: 'error',
                title: 'No se pudo enviar',
                html: `
                    <p style="margin:0">
                    ${err.message || 'Ocurrió un problema al enviar el mensaje.'}
                    </p>
                `,
                confirmButtonText: 'Entendido',
                confirmButtonColor: '#4FC6CE',
                background: '#111a2c',
                color: '#DBDBDB',
                iconColor: '#ff6b6b',
                customClass: {
                    popup: 'swal-rounded'
                }
            });

        }
    });
}
